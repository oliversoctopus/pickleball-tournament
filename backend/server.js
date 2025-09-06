// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const RoundRobinTournament = require('./roundRobin'); // Add this import

const app = express();
const server = http.createServer(app);

// Configure CORS for REST API
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true
}));

// Configure Socket.IO with CORS
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(express.json());

// In-memory storage (replace with database in production)
const tournaments = new Map();
const games = new Map();
const roundRobinTournaments = new Map(); // Add this storage

// Tournament structure
class Tournament {
  constructor(name, organizerId) {
    this.id = uuidv4();
    this.name = name;
    this.organizerId = organizerId;
    this.games = [];
    this.createdAt = new Date();
    this.status = 'active'; // active, completed
    this.viewers = new Set();
  }
}

// Game structure
class Game {
  constructor(tournamentId, team1Name, team2Name, settings) {
    this.id = uuidv4();
    this.tournamentId = tournamentId;
    this.team1 = {
      name: team1Name,
      score: 0
    };
    this.team2 = {
      name: team2Name,
      score: 0
    };
    this.servingTeam = settings.servingTeam || 1;
    this.serverNumber = settings.serverNumber || 1;
    this.gameFormat = settings.gameFormat || 'singles';
    this.scoringSystem = settings.scoringSystem || 'sideout';
    this.playTo = settings.playTo || 11;
    this.history = [];
    this.status = 'in-progress'; // in-progress, completed
    this.winner = null;
    this.startedAt = new Date();
    this.completedAt = null;
    this.rallyCount = 0;
  }

  updateScore(winningTeam) {
    this.rallyCount++;
    const previousState = JSON.parse(JSON.stringify({
      team1: this.team1,
      team2: this.team2,
      servingTeam: this.servingTeam,
      serverNumber: this.serverNumber
    }));

    if (this.scoringSystem === 'rally') {
      this.handleRallyScoring(winningTeam);
    } else {
      this.handleSideoutScoring(winningTeam);
    }

    this.history.push({
      ...previousState,
      timestamp: new Date(),
      action: `Rally won by Team ${winningTeam}`
    });

    this.checkWinner();
    return this.getGameState();
  }

  handleRallyScoring(winningTeam) {
    if (winningTeam === 1) {
      this.team1.score++;
      if (this.servingTeam === 2) {
        this.servingTeam = 1;
        this.serverNumber = 1;
      }
    } else {
      this.team2.score++;
      if (this.servingTeam === 1) {
        this.servingTeam = 2;
        this.serverNumber = 1;
      }
    }
  }

  handleSideoutScoring(winningTeam) {
    if (winningTeam === 1) {
      if (this.servingTeam === 1) {
        this.team1.score++;
      } else {
        this.handleSideOut();
      }
    } else {
      if (this.servingTeam === 2) {
        this.team2.score++;
      } else {
        this.handleSideOut();
      }
    }
  }

  handleSideOut() {
    if (this.gameFormat === 'doubles') {
      if (this.servingTeam === 1 && this.serverNumber === 1 && 
          !(this.rallyCount <= 1 && this.scoringSystem === 'sideout')) {
        this.serverNumber = 2;
      } else if (this.servingTeam === 2 && this.serverNumber === 1) {
        this.serverNumber = 2;
      } else {
        this.servingTeam = this.servingTeam === 1 ? 2 : 1;
        this.serverNumber = 1;
      }
    } else {
      this.servingTeam = this.servingTeam === 1 ? 2 : 1;
    }
  }

  checkWinner() {
    const team1Score = this.team1.score;
    const team2Score = this.team2.score;
    const winBy2 = Math.abs(team1Score - team2Score) >= 2;

    if ((team1Score >= this.playTo || team2Score >= this.playTo) && winBy2) {
      this.winner = team1Score > team2Score ? 1 : 2;
      this.status = 'completed';
      this.completedAt = new Date();
    }
  }

  undo() {
    if (this.history.length > 0) {
      const previousState = this.history.pop();
      this.team1 = previousState.team1;
      this.team2 = previousState.team2;
      this.servingTeam = previousState.servingTeam;
      this.serverNumber = previousState.serverNumber;
      this.rallyCount = Math.max(0, this.rallyCount - 1);
      
      // Reopen game if it was completed
      if (this.status === 'completed') {
        this.status = 'in-progress';
        this.winner = null;
        this.completedAt = null;
      }
      
      return this.getGameState();
    }
    return null;
  }

  getGameState() {
    return {
      id: this.id,
      tournamentId: this.tournamentId,
      team1: this.team1,
      team2: this.team2,
      servingTeam: this.servingTeam,
      serverNumber: this.serverNumber,
      gameFormat: this.gameFormat,
      scoringSystem: this.scoringSystem,
      playTo: this.playTo,
      status: this.status,
      winner: this.winner,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      rallyCount: this.rallyCount,
      historyLength: this.history.length
    };
  }
}

// REST API Endpoints

// Create a new tournament
app.post('/api/tournaments', (req, res) => {
  const { name, organizerId } = req.body;
  const tournament = new Tournament(name, organizerId || uuidv4());
  tournaments.set(tournament.id, tournament);
  res.json(tournament);
});

// Get all active tournaments
app.get('/api/tournaments', (req, res) => {
  const activeTournaments = Array.from(tournaments.values())
    .filter(t => t.status === 'active')
    .map(t => ({
      id: t.id,
      name: t.name,
      createdAt: t.createdAt,
      gameCount: t.games.length,
      viewerCount: t.viewers.size
    }));
  res.json(activeTournaments);
});

// Get tournament details
app.get('/api/tournaments/:id', (req, res) => {
  const tournament = tournaments.get(req.params.id);
  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }
  
  const tournamentData = {
    ...tournament,
    viewers: Array.from(tournament.viewers),
    games: tournament.games.map(gameId => games.get(gameId)?.getGameState())
  };
  res.json(tournamentData);
});

// Create a new game in a tournament
app.post('/api/tournaments/:tournamentId/games', (req, res) => {
  const { tournamentId } = req.params;
  const { team1Name, team2Name, settings } = req.body;
  
  const tournament = tournaments.get(tournamentId);
  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }

  const game = new Game(tournamentId, team1Name, team2Name, settings);
  games.set(game.id, game);
  tournament.games.push(game.id);
  
  // Notify all viewers
  io.to(`tournament-${tournamentId}`).emit('gameCreated', game.getGameState());
  
  res.json(game.getGameState());
});

// Get game state
app.get('/api/games/:id', (req, res) => {
  const game = games.get(req.params.id);
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }
  res.json(game.getGameState());
});

// Update game score
app.post('/api/games/:id/score', (req, res) => {
  const { winningTeam } = req.body;
  const game = games.get(req.params.id);
  
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }
  
  if (game.status === 'completed') {
    return res.status(400).json({ error: 'Game is already completed' });
  }

  const gameState = game.updateScore(winningTeam);
  
  // Notify all viewers in the tournament
  io.to(`tournament-${game.tournamentId}`).emit('scoreUpdate', gameState);
  io.to(`game-${game.id}`).emit('scoreUpdate', gameState);
  
  res.json(gameState);
});

// Undo last action
app.post('/api/games/:id/undo', (req, res) => {
  const game = games.get(req.params.id);
  
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }

  const gameState = game.undo();
  if (!gameState) {
    return res.status(400).json({ error: 'No actions to undo' });
  }
  
  // Notify all viewers
  io.to(`tournament-${game.tournamentId}`).emit('scoreUpdate', gameState);
  io.to(`game-${game.id}`).emit('scoreUpdate', gameState);
  
  res.json(gameState);
});

// Manual serve switch
app.post('/api/games/:id/switch-serve', (req, res) => {
  const game = games.get(req.params.id);
  
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }

  // Save current state to history
  const previousState = JSON.parse(JSON.stringify({
    team1: game.team1,
    team2: game.team2,
    servingTeam: game.servingTeam,
    serverNumber: game.serverNumber
  }));
  
  game.handleSideOut();
  
  game.history.push({
    ...previousState,
    timestamp: new Date(),
    action: 'Manual serve switch'
  });
  
  const gameState = game.getGameState();
  
  // Notify all viewers
  io.to(`tournament-${game.tournamentId}`).emit('scoreUpdate', gameState);
  io.to(`game-${game.id}`).emit('scoreUpdate', gameState);
  
  res.json(gameState);
});

// ============= ROUND-ROBIN ENDPOINTS START HERE =============

// Create a round-robin tournament
app.post('/api/round-robin/tournaments', (req, res) => {
  const { name, teams, organizerId } = req.body;
  
  if (!teams || teams.length < 2) {
    return res.status(400).json({ error: 'At least 2 teams are required' });
  }
  
  const tournament = new RoundRobinTournament(name, teams, organizerId || uuidv4());
  roundRobinTournaments.set(tournament.id, tournament);
  
  res.json({
    id: tournament.id,
    name: tournament.name,
    teams: tournament.teams,
    matches: tournament.matches,
    rankings: tournament.rankings
  });
});

// Get round-robin tournament details with standings
app.get('/api/round-robin/tournaments/:id', (req, res) => {
  const tournament = roundRobinTournaments.get(req.params.id);
  
  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }
  
  res.json(tournament.getStandings());
});

// Get all round-robin tournaments
app.get('/api/round-robin/tournaments', (req, res) => {
  const tournaments = Array.from(roundRobinTournaments.values()).map(t => ({
    id: t.id,
    name: t.name,
    status: t.status,
    teamsCount: t.teams.length,
    completedMatches: t.matches.filter(m => m.status === 'completed').length,
    totalMatches: t.matches.length,
    createdAt: t.createdAt
  }));
  
  res.json(tournaments);
});

// Start a match in round-robin tournament
app.post('/api/round-robin/tournaments/:tournamentId/matches/:matchId/start', (req, res) => {
  const { tournamentId, matchId } = req.params;
  const { settings } = req.body;
  
  const tournament = roundRobinTournaments.get(tournamentId);
  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }
  
  const match = tournament.matches.find(m => m.id === matchId);
  if (!match) {
    return res.status(404).json({ error: 'Match not found' });
  }
  
  if (match.status !== 'pending') {
    return res.status(400).json({ error: 'Match already started or completed' });
  }
  
  // Create a game using your existing Game class
  const game = new Game(
    tournamentId,
    match.team1.name,
    match.team2.name,
    settings || {
      playTo: 11,
      gameFormat: 'singles',
      scoringSystem: 'sideout',
      servingTeam: 1,
      serverNumber: 1
    }
  );
  
  games.set(game.id, game);
  match.gameId = game.id;
  match.status = 'in-progress';
  
  // Emit to WebSocket
  io.to(`round-robin-${tournamentId}`).emit('matchStarted', {
    tournamentId,
    matchId,
    gameId: game.id,
    match
  });
  
  res.json({
    match,
    game: game.getGameState()
  });
});

// Complete a match and update tournament standings
app.post('/api/round-robin/tournaments/:tournamentId/matches/:matchId/complete', (req, res) => {
  const { tournamentId, matchId } = req.params;
  
  const tournament = roundRobinTournaments.get(tournamentId);
  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }
  
  const match = tournament.matches.find(m => m.id === matchId);
  if (!match || !match.gameId) {
    return res.status(404).json({ error: 'Match not found or not started' });
  }
  
  const game = games.get(match.gameId);
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }
  
  if (game.status !== 'completed') {
    return res.status(400).json({ error: 'Game is not completed yet' });
  }
  
  // Update tournament with match result
  tournament.updateMatchResult(matchId, game.team1.score, game.team2.score);
  
  // Emit updated standings
  io.to(`round-robin-${tournamentId}`).emit('standingsUpdated', tournament.getStandings());
  
  res.json(tournament.getStandings());
});

// Get current standings/rankings
app.get('/api/round-robin/tournaments/:id/standings', (req, res) => {
  const tournament = roundRobinTournaments.get(req.params.id);
  
  if (!tournament) {
    return res.status(404).json({ error: 'Tournament not found' });
  }
  
  res.json({
    rankings: tournament.rankings,
    teams: tournament.teams,
    tiedGroups: tournament.findTiedGroups()
  });
});

// ============= ROUND-ROBIN ENDPOINTS END HERE =============

// WebSocket handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Join a tournament room as viewer
  socket.on('joinTournament', (tournamentId) => {
    const tournament = tournaments.get(tournamentId);
    if (tournament) {
      socket.join(`tournament-${tournamentId}`);
      tournament.viewers.add(socket.id);
      
      // Send current tournament state
      socket.emit('tournamentState', {
        ...tournament,
        viewers: Array.from(tournament.viewers),
        games: tournament.games.map(gameId => games.get(gameId)?.getGameState())
      });
      
      // Notify others of new viewer
      socket.to(`tournament-${tournamentId}`).emit('viewerJoined', {
        viewerCount: tournament.viewers.size
      });
      
      console.log(`Socket ${socket.id} joined tournament ${tournamentId}`);
    }
  });

  // Join a specific game room
  socket.on('joinGame', (gameId) => {
    const game = games.get(gameId);
    if (game) {
      socket.join(`game-${gameId}`);
      socket.emit('gameState', game.getGameState());
      console.log(`Socket ${socket.id} joined game ${gameId}`);
    }
  });

  // Leave tournament room
  socket.on('leaveTournament', (tournamentId) => {
    const tournament = tournaments.get(tournamentId);
    if (tournament) {
      socket.leave(`tournament-${tournamentId}`);
      tournament.viewers.delete(socket.id);
      
      // Notify others
      socket.to(`tournament-${tournamentId}`).emit('viewerLeft', {
        viewerCount: tournament.viewers.size
      });
    }
  });

  // Join round-robin tournament room
  socket.on('joinRoundRobin', (tournamentId) => {
    const tournament = roundRobinTournaments.get(tournamentId);
    if (tournament) {
      socket.join(`round-robin-${tournamentId}`);
      socket.emit('roundRobinState', tournament.getStandings());
      console.log(`Socket ${socket.id} joined round-robin tournament ${tournamentId}`);
    }
  });
  
  // Leave round-robin tournament room
  socket.on('leaveRoundRobin', (tournamentId) => {
    socket.leave(`round-robin-${tournamentId}`);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Remove from all tournament viewer lists
    tournaments.forEach((tournament, tournamentId) => {
      if (tournament.viewers.has(socket.id)) {
        tournament.viewers.delete(socket.id);
        io.to(`tournament-${tournamentId}`).emit('viewerLeft', {
          viewerCount: tournament.viewers.size
        });
      }
    });
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});