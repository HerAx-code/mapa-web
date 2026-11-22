import { functions, httpsCallable } from '../firebase'

// The agency's decisions and letters run on the server (Phase 2 PR 2.3,
// functions/src/sliceActions.js). The page asks; the function re-reads the
// slice, the request and the budget, then writes everything in one
// transaction. Errors carry a message meant for the coordinator.
//   decideSlice  { sliceId, action: request_info | resume | approve | reject, ... }
//   settleLetter { sliceId, action: mark_issued | redeem | undo_redeem | expire | reverse, redeemedAmount? }
export const decideSlice = (data) => httpsCallable(functions, 'decideSlice')(data)
export const settleLetter = (data) => httpsCallable(functions, 'settleLetter')(data)
