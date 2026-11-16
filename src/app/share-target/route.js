// Stickers shared to the app from Android's share sheet are normally caught on the phone by public/push-sw.js.
// If the app's helper wasn't running yet (the very first time), the request lands here instead: open the chat
// rather than show an error. The files can't be passed on from the server, so sharing them again will work.
export function POST(req) {
  return Response.redirect(new URL('/?view=chat', req.url), 303);
}
