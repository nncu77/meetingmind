import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'meetingmind',
  eventKey: process.env.INNGEST_EVENT_KEY,
});

export type MeetingProcessEvent = {
  name: 'meeting/process.requested';
  data: {
    meetingId: string;
    audioUrl: string;
    language: 'zh' | 'zh-en';
    privacyLevel: 'standard' | 'enhanced' | 'strict';
  };
};
