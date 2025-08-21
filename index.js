const express = require('express');
const app = express();

app.get('/', (_, res) => res.send('Spotify bot is live and on repeat!'));
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('Listening on', PORT));
