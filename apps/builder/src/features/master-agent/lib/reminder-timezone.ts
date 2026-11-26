/**
 * Mirrors `MASTER_AGENT_TIMEZONE` in `@inboxos.io/business`. Duplicated because
 * a client component must not import the business graph (it pulls the DB
 * client); this is the only place the chat formats a reminder time.
 */
export const REMINDER_TIMEZONE = "Asia/Saigon"
