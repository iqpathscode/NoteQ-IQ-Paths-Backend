// utility/notesheetGuards.js
import NotesheetFlow from "../models/notes/notesheetFlow.model.js";

/**
 * checkQueryBlock
 * ───────────────
 * Agar kisi notesheet par QUERY_RAISED status hai
 * toh QUERY_REPLY ke alawa koi bhi action block karo.
 *
 * @param {string}  noteId
 * @param {object}  session  - optional mongoose session (transaction ke liye)
 * @returns {{ blocked: boolean, message?: string }}
 */
export const checkQueryBlock = async (noteId, session = null) => {
  const q = NotesheetFlow.findOne({
    note_id:      noteId,
    action:       'QUERY',
    final_status: 'QUERY_RAISED',
  }).sort({ createdAt: -1 });

  if (session) q.session(session);

  const openQuery = await q;

  if (openQuery) {
    return {
      blocked: true,
      message: 'Is notesheet par ek query pending hai. Pehle query ka reply aane do.',
    };
  }

  return { blocked: false };
};

/**
 * canRaiseQuery
 * ─────────────
 * Query sirf tab raise ho sakti hai jab:
 *  1. Notesheet level 1 par na ho (yaani koi FORWARDED record ho)
 *  2. Pehle se koi QUERY_RAISED open na ho
 *
 * @param {string} noteId
 * @returns {{ allowed: boolean, message?: string, lastForwardedStep?: object }}
 */
export const canRaiseQuery = async (noteId) => {
  // Check if there's already an open query
  const openQuery = await NotesheetFlow.findOne({
    note_id:      noteId,
    action:       'QUERY',
    final_status: 'QUERY_RAISED',
  });

  if (openQuery) {
    return {
      allowed: false,
      message: 'A query is already pending. You can send a new query only after the reply is received.',
    };
  }

  // Check if there's any FORWARDED step
  const lastForwardedStep = await NotesheetFlow.findOne({
    note_id: noteId,
    action:  'FORWARDED',
  }).sort({ createdAt: -1 });

  if (!lastForwardedStep) {
    return {
      allowed: false,
      message: 'This notesheet has only just been created. It must be forwarded before a query can be raised.',
    };
  }

  return { allowed: true, lastForwardedStep };
};
