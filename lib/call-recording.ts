// Does this call have a recording we can actually play?
//
// One rule, one place. Three surfaces asked this question with their own copy
// of the answer — the Queue history list, the lead-detail thread, and CallCard
// — and all three guessed the same wrong way: they treated
// `status === "answered" && duration > 0` as proof a recording exists.
//
// It isn't. On an outbound call Aircall reports a duration for the ringing
// time, so a call the prospect never picked up still arrives with
// `duration: 15` while Aircall's own record shows `answered_at: null` and no
// recording asset. 385 calls were in that state on 2026-09-03; each one drew a
// player that could never load, which is what "the calls aren't being
// recorded" turned out to mean.
//
// So: only claim a recording when we have one. `recording_url` means Aircall
// handed us an asset; `recording_storage_path` means we archived it. Nothing
// else counts, and neither does a guess.
//
// Pure and dependency-free so client components can import it.

export type CallRecordingFields = {
  recording_url?: string | null;
  recording_storage_path?: string | null;
};

export function hasPlayableRecording(call: CallRecordingFields): boolean {
  return !!call.recording_url || !!call.recording_storage_path;
}
