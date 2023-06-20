import * as path from 'path';
import * as functions from 'firebase-functions';
import * as videoTranscoder from '@google-cloud/video-transcoder';
import {google} from '@google-cloud/video-transcoder/build/protos/protos';
import {Firestore} from '@google-cloud/firestore';
import * as admin from 'firebase-admin';

import config from './config';
import * as logs from './logs';
import {hashName, shouldProcessStorageObject} from './utils';
import ICreateJobRequest = google.cloud.video.transcoder.v1.ICreateJobRequest;

export const errorFactory = (error: unknown): Error => {
  let e: Error = new Error(typeof error === 'string' ? error : 'Unknown Error');
  if (error instanceof Error) {
    e = error;
  }
  return e;
};

const videoTranscoderServiceClient =
  new videoTranscoder.TranscoderServiceClient();

// Initialize Firestore
admin.initializeApp();
const db = admin.firestore();

logs.init();

exports.transcodevideo = functions.storage.object().onFinalize(async object => {
  if (!object.name) return;
  if (!shouldProcessStorageObject(object.name)) return;

  const templateId: string =
    object.metadata?.videoTranscoderTemplateId || config.defaultTemplateId;

  const outputUri = `gs://${config.outputVideosBucket}${
    config.outputVideosPath
  }${path.basename(object.name)}/`;

  if (templateId !== 'preset/web-hd') {
    try {
      await videoTranscoderServiceClient.getJobTemplate({
        name: videoTranscoderServiceClient.jobTemplatePath(
          config.projectId,
          config.location,
          templateId
        ),
      });
    } catch (ex) {
      logs.templateDoesNotExist(object.name, templateId);
      return;
    }
  }

  const jobRequest: ICreateJobRequest = {
    parent: videoTranscoderServiceClient.locationPath(
      config.projectId,
      config.location
    ),
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
    .doc(hashName(`gs://${object.bucket}/${object.name}`));

  try {
    await videoTranscoderServiceClient.createJob(jobRequest);
    await logRef.set({
      original: `gs://${object.bucket}/${object.name}`,
      transcoded: outputUri,
      status: 'Queued',
    });
  } catch (e) {
    const ex = errorFactory(e);
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
const firestore = new Firestore();

interface TranscodeMessage {
  job: {
    config: {
      inputs: {key: string; uri: string}[];
      output: {uri: string};
    };
    createTime: string;
    endTime: string;
    name: string;
    startTime: string;
    state: string;
    ttlAfterCompletionDays: number;
  };
}

exports.listenForPubSubMessage = functions.pubsub
  .topic('fuzzy_explore_video_status')
  .onPublish(async message => {
    const data = JSON.parse(Buffer.from(message.data, 'base64').toString());

    const jobPath = data.job.name; // Get the job name from the message

    const [job] = await videoTranscoderServiceClient.getJob({name: jobPath}); // Get job details

    let original;
    let transcoded;
    if (
      job.config &&
      job.config.inputs &&
      job.config.inputs.length > 0 &&
      job.config.output
    ) {
      original = job.config.inputs[0].uri;
      transcoded = job.config.output.uri;
    } else {
      original = '';
      transcoded = '';
    }
    const status = job.state;
    const error = ''; // Add error handling here based on your needs

    // Convert the `original` value to a string that can be used as a Firestore document ID
    // For example, you can replace all '/' characters with '-' to prevent issues
    const documentId = hashName(original || 'error');

    // Use `set` with `{ merge: true }` to create or update the document
    await firestore.collection('transcoder').doc(documentId).set(
      {
        original,
        transcoded,
        status,
        error,
        zDetails: job, // Save the entire job object as the "details" field
        width:
          job.config?.elementaryStreams?.[0]?.videoStream?.h265?.widthPixels,
        height:
          job.config?.elementaryStreams?.[0]?.videoStream?.h265?.heightPixels,
        duration: job.config?.editList?.[0]?.endTimeOffset?.seconds,
      },
      {merge: true}
    );

    console.log('Added/updated job status in Firestore');
  });
