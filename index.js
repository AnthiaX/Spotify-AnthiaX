// Load environment variables
import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import dayjs from 'dayjs';

const app = express();
app.use(express.json());
app.use(cookieParser());

// In-memory store for tokens (replace with DB if needed)
const store = new Map();

const {
  PORT = 8080,
  BASE_URL,
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI
} = process.env;

const SPOTIFY_AUTH = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API = 'https://api.spotify.com/v1';

// Helper: refresh token if expired
async function refreshIfNeeded(userId) {
  const rec = store.get(userId);
  if (!rec) throw new Error('Unknown user');
  if (dayjs().isBefore(dayjs(rec.expires_at))) return rec.access_token;

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: rec.refresh_token,
    client_id: SPOTIFY_CLIENT_ID,
    client_secret: SPOTIFY_CLIENT_SECRET
  });

  const { data } = await axios.post(SPOTIFY_TOKEN, params);
  rec.access_token = data.access_token;
  rec.expires_at = dayjs().add(data.expires_in - 30, 'second').toISOString();
  store.set(userId, rec);
  return rec.access_token;
}

// 1) Login
app.get('/auth/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('spotify_state', state, { httpOnly: true, sameSite: 'lax', secure: true });

  const scope = [
    'user-top-read',
    'user-read-email'
  ].join(' ');

  const url = new URL(SPOTIFY_AUTH);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', SPOTIFY_CLIENT_ID);
  url.searchParams.set('scope', scope);
  url.searchParams.set('redirect_uri', SPOTIFY_REDIRECT_URI);
  url.searchParams.set('state', state);

  res.redirect(url.toString());
});

// 2) Callback
app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  const cookieState = req.cookies['spotify_state'];
  if (!state || state !== cookieState) return res.status(400).send('State mismatch');

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    client_id: SPOTIFY_CLIENT_ID,
    client_secret: SPOTIFY_CLIENT_SECRET
  });

  try {
    const { data } = await axios.post(SPOTIFY_TOKEN, params);

    // Get Spotify user profile
    const { data: me } = await axios.get(`${SPOTIFY_API}/me`, {
      headers: { Authorization: `Bearer ${data.access_token}` }
    });

    const userId = me.id;

    store.set(userId, {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: dayjs().add(data.expires_in - 30, 'second').toISOString()
    });

    res.send(`✅ Connected Spotify for user: ${userId}. You can close this tab.`);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send('Error exchanging token');
  }
});

// 3) Get user’s top tracks or artists
app.get('/api/:userId/top', async (req, res) => {
  try {
    const token = await refreshIfNeeded(req.params.userId);
    const { type = 'tracks', time_range = 'long_term', limit = 10 } = req.query;

    // type: "tracks" or "artists"
    // time_range: "short_term" (4 weeks), "medium_term" (6 months), "long_term" (several years)

    const { data } = await axios.get(`${SPOTIFY_API}/me/top/${type}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { time_range, limit }
    });

    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Root route
app.get('/', (req, res) => {
  res.send('🎶 Spotify bot running (top tracks/artists enabled)');
});

// Start server
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
