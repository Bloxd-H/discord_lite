// api/discord.js
import fetch from 'node-fetch';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { login, password } = req.body;

  if (!login || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    const discordRes = await fetch('https://discord.com/api/v9/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password }),
    });
    
    const data = await discordRes.json();
    res.status(discordRes.status).json(data);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}
