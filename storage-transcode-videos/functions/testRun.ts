import {TranscoderServiceClient} from '@google-cloud/video-transcoder';
import {google} from '@google-cloud/video-transcoder/build/protos/protos';

const kProjectId = 'fuzzy-day';
const kLocation = 'us-central1';
const inputUri = 'gs://fuzzy-day.appspot.com/videos/heavenHelpMe.mp4';
const outputUri = 'gs://fuzzy-day.appspot.com/video_transcoding_output/test2/';
const templateId = 'bcbasic_fuzzy_dev';

const transcoderServiceClient: TranscoderServiceClient =
  new TranscoderServiceClient();

type ICreateJobRequest = google.cloud.video.transcoder.v1.ICreateJobRequest;
type IGetJobRequest = google.cloud.video.transcoder.v1.IGetJobRequest;

async function createJobFromPreset() {
  const jobRequest: ICreateJobRequest = {
    parent: transcoderServiceClient.locationPath(kProjectId, kLocation),
    job: {
      inputUri,
      outputUri,
      templateId: templateId,
    },
  };

  // Run request
  const [response] = await transcoderServiceClient.createJob(jobRequest);
  console.log(`Job created: ${response.name}`);

  // Check job status every 3 seconds
  const jobName = response.name;

  const checkJobStatus = setInterval(async () => {
    const getJobRequest: IGetJobRequest = {
      name: jobName,
    };

    const [job] = await transcoderServiceClient.getJob(getJobRequest);
    const jobStatus = job.state;

    console.log(`Job status: ${jobStatus}`);

    if (jobStatus === 'SUCCEEDED' || jobStatus === 'FAILED') {
      clearInterval(checkJobStatus);
    }
  }, 3000);
}

createJobFromPreset();
