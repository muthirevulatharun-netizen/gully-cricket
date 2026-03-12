const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// In-memory "database"
const teams = new Map(); // id -> team
const matches = new Map(); // id -> match

let currentMatchId = null;

function generateId(prefix) {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}_${random}`;
}

function generateAccessCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function createMatchState({ id, battingTeamId, bowlingTeamId, totalOvers }) {
  return {
    id,
    battingTeamId,
    bowlingTeamId,
    totalOvers,
    runs: 0,
    wickets: 0,
    balls: 0,
    extras: 0,
    history: [] // each entry: { runs, isWicket, extraType }
  };
}

function formatOver(balls) {
  const overs = Math.floor(balls / 6);
  const ballsPart = balls % 6;
  return `${overs}.${ballsPart}`;
}

function calculateRunRate(runs, balls) {
  if (!balls) return 0;
  const overs = balls / 6;
  return Number((runs / overs).toFixed(2));
}

function serializeMatch(match) {
  return {
    id: match.id,
    battingTeamId: match.battingTeamId,
    bowlingTeamId: match.bowlingTeamId,
    totalOvers: match.totalOvers,
    score: {
      runs: match.runs,
      wickets: match.wickets,
      overs: formatOver(match.balls),
      balls: match.balls,
      extras: match.extras,
      runRate: calculateRunRate(match.runs, match.balls)
    },
    history: match.history
  };
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Gully Cricket backend is running' });
});

// Team endpoints
app.post('/api/teams', (req, res) => {
  const { name, players = [], rosterSize } = req.body || {};

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Team name is required' });
  }

  const id = generateId('TEAM');
  const accessCode = generateAccessCode();

  const team = {
    id,
    name,
    rosterSize: typeof rosterSize === 'number' ? rosterSize : null,
    players,
    accessCode,
    createdAt: new Date().toISOString()
  };

  teams.set(id, team);

  res.status(201).json(team);
});

app.get('/api/teams/:id', (req, res) => {
  const team = teams.get(req.params.id);
  if (!team) {
    return res.status(404).json({ error: 'Team not found' });
  }
  res.json(team);
});

app.post('/api/auth/team/login', (req, res) => {
  const { name, accessCode } = req.body || {};
  if (!name || !accessCode) {
    return res.status(400).json({ error: 'Name and access code are required' });
  }

  const team = Array.from(teams.values()).find(
    (t) => t.name.toLowerCase() === name.toLowerCase() && t.accessCode === accessCode
  );

  if (!team) {
    return res.status(401).json({ error: 'Invalid team name or access code' });
  }

  res.json({ teamId: team.id, name: team.name });
});

// Match endpoints
app.post('/api/matches', (req, res) => {
  const { battingTeamId, bowlingTeamId, totalOvers = 20 } = req.body || {};

  if (!battingTeamId || !bowlingTeamId) {
    return res.status(400).json({ error: 'Batting and bowling team IDs are required' });
  }

  if (!teams.get(battingTeamId) || !teams.get(bowlingTeamId)) {
    return res.status(400).json({ error: 'Both teams must exist' });
  }

  const id = generateId('MATCH');
  const match = createMatchState({ id, battingTeamId, bowlingTeamId, totalOvers });

  matches.set(id, match);
  currentMatchId = id;

  res.status(201).json(serializeMatch(match));
});

app.get('/api/matches/current', (req, res) => {
  if (!currentMatchId) {
    return res.status(404).json({ error: 'No current match' });
  }

  const match = matches.get(currentMatchId);
  if (!match) {
    return res.status(404).json({ error: 'Match not found' });
  }

  res.json(serializeMatch(match));
});

app.get('/api/matches/:id', (req, res) => {
  const match = matches.get(req.params.id);
  if (!match) {
    return res.status(404).json({ error: 'Match not found' });
  }
  res.json(serializeMatch(match));
});

app.post('/api/matches/:id/ball', (req, res) => {
  const match = matches.get(req.params.id);
  if (!match) {
    return res.status(404).json({ error: 'Match not found' });
  }

  const { runs = 0, isWicket = false, extraType = null } = req.body || {};

  if (typeof runs !== 'number' || runs < 0) {
    return res.status(400).json({ error: 'Runs must be a non-negative number' });
  }

  const isLegalDelivery = extraType === null || extraType === 'bye' || extraType === 'legBye';

  match.runs += runs;

  if (extraType && (extraType === 'wide' || extraType === 'noBall' || extraType === 'bye' || extraType === 'legBye')) {
    match.extras += runs;
  }

  if (isWicket) {
    match.wickets += 1;
  }

  if (isLegalDelivery) {
    match.balls += 1;
  }

  match.history.push({ runs, isWicket, extraType });

  res.json(serializeMatch(match));
});

app.post('/api/matches/:id/undo', (req, res) => {
  const match = matches.get(req.params.id);
  if (!match) {
    return res.status(404).json({ error: 'Match not found' });
  }

  const last = match.history.pop();
  if (!last) {
    return res.status(400).json({ error: 'No balls to undo' });
  }

  const { runs, isWicket, extraType } = last;
  const wasLegal = extraType === null || extraType === 'bye' || extraType === 'legBye';

  match.runs -= runs;
  if (match.runs < 0) match.runs = 0;

  if (extraType && (extraType === 'wide' || extraType === 'noBall' || extraType === 'bye' || extraType === 'legBye')) {
    match.extras -= runs;
    if (match.extras < 0) match.extras = 0;
  }

  if (isWicket) {
    match.wickets = Math.max(0, match.wickets - 1);
  }

  if (wasLegal) {
    match.balls = Math.max(0, match.balls - 1);
  }

  res.json(serializeMatch(match));
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Gully Cricket backend listening on http://localhost:${PORT}`);
});

