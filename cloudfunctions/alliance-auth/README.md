# Alliance Steam authentication

This HTTP function verifies a Steam `GetAuthTicketForWebApi` ticket and returns
a short-lived signed alliance session token.

Required server environment variables:

- `STEAM_PUBLISHER_API_KEY`: Steamworks publisher Web API key. Never expose it to the client.
- `ALLIANCE_SESSION_SECRET`: random secret used to sign the session token.
- `ALLOWED_ORIGIN`: production game origin, if CORS should be restricted.

The client must call `SteamBridge.getAuthTicket()` with the identity
`deep-space-idle-alliance` and send the returned base64 ticket as `{ ticket }`.
