// backend/roundRobin.js
const { v4: uuidv4 } = require('uuid');

class RoundRobinTournament {
  constructor(name, teams, organizerId) {
    this.id = uuidv4();
    this.name = name;
    this.organizerId = organizerId;
    this.teams = teams.map(teamName => ({
      id: uuidv4(),
      name: teamName,
      gamesWon: 0,
      gamesLost: 0,
      pointsScored: 0,
      pointsConceded: 0,
      pointDifference: 0,
      matches: []
    }));
    this.matches = this.generateRoundRobinSchedule();
    this.rankings = [];
    this.status = 'in-progress';
    this.createdAt = new Date();
  }

  generateRoundRobinSchedule() {
    const matches = [];
    const teams = this.teams;
    
    // Generate all possible matches (each team plays every other team once)
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        matches.push({
          id: uuidv4(),
          team1: {
            id: teams[i].id,
            name: teams[i].name,
            score: 0
          },
          team2: {
            id: teams[j].id,
            name: teams[j].name,
            score: 0
          },
          status: 'pending',
          gameId: null, // Will be set when game is started
          completedAt: null
        });
      }
    }
    
    return matches;
  }

  updateMatchResult(matchId, team1Score, team2Score) {
    const match = this.matches.find(m => m.id === matchId);
    if (!match) return null;
    
    // Update match scores
    match.team1.score = team1Score;
    match.team2.score = team2Score;
    match.status = 'completed';
    match.completedAt = new Date();
    
    // Determine winner
    const winner = team1Score > team2Score ? match.team1 : match.team2;
    const loser = team1Score > team2Score ? match.team2 : match.team1;
    const winnerScore = Math.max(team1Score, team2Score);
    const loserScore = Math.min(team1Score, team2Score);
    
    // Update team statistics
    const winnerTeam = this.teams.find(t => t.id === winner.id);
    const loserTeam = this.teams.find(t => t.id === loser.id);
    
    if (winnerTeam && loserTeam) {
      // Update winner stats
      winnerTeam.gamesWon++;
      winnerTeam.pointsScored += winnerScore;
      winnerTeam.pointsConceded += loserScore;
      winnerTeam.pointDifference = winnerTeam.pointsScored - winnerTeam.pointsConceded;
      winnerTeam.matches.push({
        opponentId: loser.id,
        opponentName: loser.name,
        result: 'won',
        scoreFor: winnerScore,
        scoreAgainst: loserScore
      });
      
      // Update loser stats
      loserTeam.gamesLost++;
      loserTeam.pointsScored += loserScore;
      loserTeam.pointsConceded += winnerScore;
      loserTeam.pointDifference = loserTeam.pointsScored - loserTeam.pointsConceded;
      loserTeam.matches.push({
        opponentId: winner.id,
        opponentName: winner.name,
        result: 'lost',
        scoreFor: loserScore,
        scoreAgainst: winnerScore
      });
    }
    
    // Recalculate rankings
    this.calculateRankings();
    
    // Check if tournament is complete
    const allMatchesComplete = this.matches.every(m => m.status === 'completed');
    if (allMatchesComplete) {
      this.status = 'completed';
    }
    
    return match;
  }

  calculateRankings() {
    // Create a copy of teams for sorting
    const rankedTeams = [...this.teams];
    
    // Sort teams based on the ranking rules
    rankedTeams.sort((a, b) => {
      // Rule 1: Higher Games Won (GW)
      if (a.gamesWon !== b.gamesWon) {
        return b.gamesWon - a.gamesWon;
      }
      
      // Rule 2-a: Total Point Difference (TPD)
      if (a.pointDifference !== b.pointDifference) {
        return b.pointDifference - a.pointDifference;
      }
      
      // Rule 2-b: Total Points Scored (TPS)
      if (a.pointsScored !== b.pointsScored) {
        return b.pointsScored - a.pointsScored;
      }
      
      // Rule 2-c: Head-to-Head Record
      const h2h = this.getHeadToHeadResult(a.id, b.id);
      if (h2h !== 0) {
        return h2h;
      }
      
      // Rule 2-d: Lottery (random for now, can be replaced with actual lottery)
      return Math.random() - 0.5;
    });
    
    // Assign ranks
    this.rankings = rankedTeams.map((team, index) => ({
      rank: index + 1,
      teamId: team.id,
      teamName: team.name,
      gamesWon: team.gamesWon,
      gamesLost: team.gamesLost,
      pointsScored: team.pointsScored,
      pointsConceded: team.pointsConceded,
      pointDifference: team.pointDifference
    }));
    
    return this.rankings;
  }

  getHeadToHeadResult(team1Id, team2Id) {
    const team1 = this.teams.find(t => t.id === team1Id);
    const team2 = this.teams.find(t => t.id === team2Id);
    
    if (!team1 || !team2) return 0;
    
    // Find the match between these two teams
    const h2hMatch = team1.matches.find(m => m.opponentId === team2Id);
    
    if (!h2hMatch) return 0;
    
    // If team1 won against team2, team1 ranks higher (negative return)
    if (h2hMatch.result === 'won') return -1;
    if (h2hMatch.result === 'lost') return 1;
    
    // If tied (shouldn't happen in pickleball), check point difference in their match
    const h2hPointDiff = h2hMatch.scoreFor - h2hMatch.scoreAgainst;
    if (h2hPointDiff !== 0) return -h2hPointDiff;
    
    // Check total points scored in their match
    return -h2hMatch.scoreFor;
  }

  getStandings() {
    return {
      tournament: {
        id: this.id,
        name: this.name,
        status: this.status
      },
      rankings: this.rankings,
      teams: this.teams.map(team => ({
        ...team,
        winPercentage: team.gamesWon + team.gamesLost > 0 
          ? (team.gamesWon / (team.gamesWon + team.gamesLost) * 100).toFixed(1)
          : '0.0'
      })),
      matches: this.matches
    };
  }

  getUpcomingMatches() {
    return this.matches.filter(m => m.status === 'pending');
  }

  getCompletedMatches() {
    return this.matches.filter(m => m.status === 'completed');
  }

  // Find teams that are tied based on primary criteria
  findTiedGroups() {
    const groups = [];
    const processed = new Set();
    
    for (const team of this.teams) {
      if (processed.has(team.id)) continue;
      
      const tiedTeams = this.teams.filter(t => 
        t.gamesWon === team.gamesWon &&
        t.pointDifference === team.pointDifference &&
        t.pointsScored === team.pointsScored
      );
      
      if (tiedTeams.length > 1) {
        groups.push(tiedTeams);
        tiedTeams.forEach(t => processed.add(t.id));
      }
    }
    
    return groups;
  }
}

module.exports = RoundRobinTournament;