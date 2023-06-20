"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorFactory = void 0;
const path = require("path");
const functions = require("firebase-functions");
const videoTranscoder = require("@google-cloud/video-transcoder");
const firestore_1 = require("@google-cloud/firestore");
const admin = require("firebase-admin");
const config_1 = require("./config");
const logs = require("./logs");
const utils_1 = require("./utils");
const errorFactory = (error) => {
    let e = new Error(typeof error === 'string' ? error : 'Unknown Error');
    if (error instanceof Error) {
        e = error;
    }
    return e;
};
exports.errorFactory = errorFactory;
const videoTranscoderServiceClient = new videoTranscoder.TranscoderServiceClient();
// Initialize Firestore
admin.initializeApp();
const db = admin.firestore();
logs.init();
exports.transcodevideo = functions.storage.object().onFinalize(async (object) => {
    var _a;
    if (!object.name)
        return;
    if (!(0, utils_1.shouldProcessStorageObject)(object.name))
        return;
    const templateId = ((_a = object.metadata) === null || _a === void 0 ? void 0 : _a.videoTranscoderTemplateId) || config_1.default.defaultTemplateId;
    const outputUri = `gs://${config_1.default.outputVideosBucket}${config_1.default.outputVideosPath}${path.basename(object.name)}/`;
    if (templateId !== 'preset/web-hd') {
        try {
            await videoTranscoderServiceClient.getJobTemplate({
                name: videoTranscoderServiceClient.jobTemplatePath(config_1.default.projectId, config_1.default.location, templateId),
            });
        }
        catch (ex) {
            logs.templateDoesNotExist(object.name, templateId);
            return;
        }
    }
    const jobRequest = {
        parent: videoTranscoderServiceClient.locationPath(config_1.default.projectId, config_1.default.location),
        job: {
            inputUri: `gs://${object.bucket}/${object.name}`,
            outputUri,
            templateId,
        },
    };
    logs.transcodeVideo(object.name, jobRequest);
    // Add log to Firestore before creating the job
    const logRef = db
        .collection('transcoder')
        .doc((0, utils_1.hashName)(`gs://${object.bucket}/${object.name}`));
    try {
        await videoTranscoderServiceClient.createJob(jobRequest);
        await logRef.set({
            original: `gs://${object.bucket}/${object.name}`,
            transcoded: outputUri,
            status: 'Queued',
        });
    }
    catch (e) {
        const ex = (0, exports.errorFactory)(e);
        logs.jobFailed(object.name);
        // Update log in Firestore when job fails
        await logRef.update({
            original: `gs://${object.bucket}/${object.name}`,
            error: ex.message,
        });
        return;
    }
    logs.queued(object.name, outputUri);
});
// const pubSubClient = new PubSub();
const firestore = new firestore_1.Firestore();
exports.listenForPubSubMessage = functions.pubsub
    .topic('fuzzy_explore_video_status')
    .onPublish(async (message) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    const data = JSON.parse(Buffer.from(message.data, 'base64').toString());
    const jobPath = data.job.name; // Get the job name from the message
    const [job] = await videoTranscoderServiceClient.getJob({ name: jobPath }); // Get job details
    let original;
    let transcoded;
    if (job.config &&
        job.config.inputs &&
        job.config.inputs.length > 0 &&
        job.config.output) {
        original = job.config.inputs[0].uri;
        transcoded = job.config.output.uri;
    }
    else {
        original = '';
        transcoded = '';
    }
    const status = job.state;
    const error = ''; // Add error handling here based on your needs
    // Convert the `original` value to a string that can be used as a Firestore document ID
    // For example, you can replace all '/' characters with '-' to prevent issues
    const documentId = (0, utils_1.hashName)(original || 'error');
    // Use `set` with `{ merge: true }` to create or update the document
    await firestore.collection('transcoder').doc(documentId).set({
        original,
        transcoded,
        status,
        error,
        zDetails: job,
        width: (_e = (_d = (_c = (_b = (_a = job.config) === null || _a === void 0 ? void 0 : _a.elementaryStreams) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.videoStream) === null || _d === void 0 ? void 0 : _d.h265) === null || _e === void 0 ? void 0 : _e.widthPixels,
        height: (_k = (_j = (_h = (_g = (_f = job.config) === null || _f === void 0 ? void 0 : _f.elementaryStreams) === null || _g === void 0 ? void 0 : _g[0]) === null || _h === void 0 ? void 0 : _h.videoStream) === null || _j === void 0 ? void 0 : _j.h265) === null || _k === void 0 ? void 0 : _k.heightPixels,
        duration: (_p = (_o = (_m = (_l = job.config) === null || _l === void 0 ? void 0 : _l.editList) === null || _m === void 0 ? void 0 : _m[0]) === null || _o === void 0 ? void 0 : _o.endTimeOffset) === null || _p === void 0 ? void 0 : _p.seconds,
    }, { merge: true });
    console.log('Added/updated job status in Firestore');
});
