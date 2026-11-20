/** Occurrences shown at once after hydration; the rest open with «Показать ещё». */
export const ENQUIRY_OPTIONS_STEP = 5;

export type EnquiryValues = {
  parentName: string;
  phone: string;
  ageDirectionId: string;
  participantName: string;
  desiredChoice: string;
  comment: string;
};
export type EnquiryOption = {
  choice: string;
  interval: import('./weekly-interval').WeeklyInterval;
  directionId: string;
};
