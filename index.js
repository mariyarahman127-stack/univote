const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Firebase Configuration - Using REST API (no credentials needed)
const FIREBASE_DB_URL = 'https://univote1-59bd1-default-rtdb.asia-southeast1.firebasedatabase.app';

// In-memory cache for candidates (these don't change)
const candidates = [
    { id: 1, name: 'Swarna Roy', department: 'Lecturer, CSE Department', symbol: '📖', symbolName: 'Book', votes: 0, color: '#e94560' },
    { id: 2, name: 'Sumaiya Akter', department: 'Lecturer, CSE Department', symbol: '🌹', symbolName: 'Rose', votes: 0, color: '#4361ee' },
    { id: 3, name: 'Sohely Sajlin', department: 'Lecturer, CSE Department', symbol: '✈️', symbolName: 'Airplane', votes: 0, color: '#00d9a5' },
    { id: 4, name: 'Mazharul Islam', department: 'Lecturer, CSE Department', symbol: '🥭', symbolName: 'Mango', votes: 0, color: '#ffc107' },
    { id: 5, name: 'Jahangir Polash', department: 'Lecturer, CSE Department', symbol: '🦜', symbolName: 'Parrot', votes: 0, color: '#9c27b0' }
];

// Election config
const election = {
    title: 'Imperial College of Engineering',
    subtitle: 'College President Election 2026',
    status: 'active'
};

// Helper function to make Firebase REST API calls
function firebaseRequest(method, path, data = null) {
    return new Promise((resolve, reject) => {
        const url = `${FIREBASE_DB_URL}${path}.json`;
        const urlObj = new URL(url);
        
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    if (body === 'null' || body === '') {
                        resolve(null);
                    } else {
                        resolve(JSON.parse(body));
                    }
                } catch (e) {
                    resolve(null);
                }
            });
        });

        req.on('error', reject);
        
        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

// Get all votes from Firebase
async function getAllVotes() {
    const data = await firebaseRequest('GET', '/votes');
    if (!data) return [];
    return Object.entries(data).map(([key, value]) => ({
        id: key,
        ...value
    }));
}

// Get all voters from Firebase
async function getAllVoters() {
    const data = await firebaseRequest('GET', '/voters');
    if (!data) return {};
    return data;
}

// Save vote to Firebase
async function saveVoteToFirebase(voteData) {
    await firebaseRequest('POST', '/votes', voteData);
}

// Helper function to create a valid Firebase key from email
function emailToFirebaseKey(email) {
    return email.toLowerCase().replace(/@/g, '_at_').replace(/\./g, '_dot_');
}

// Save voter to Firebase
async function saveVoterToFirebase(email, voterData) {
    const firebaseKey = emailToFirebaseKey(email);
    await firebaseRequest('PUT', `/voters/${firebaseKey}`, voterData);
}

// API Routes
app.get('/api/election', (req, res) => res.json(election));
app.get('/api/candidates', (req, res) => res.json(candidates));

app.get('/api/results', async (req, res) => {
    try {
        const votes = await getAllVotes();
        const totalVotes = votes.length;
        
        // Calculate votes per candidate
        const voteCounts = {};
        candidates.forEach(c => voteCounts[c.id] = 0);
        votes.forEach(v => {
            if (voteCounts[v.candidateId] !== undefined) {
                voteCounts[v.candidateId]++;
            }
        });
        
        const resultCandidates = candidates.map(c => ({
            ...c,
            votes: voteCounts[c.id] || 0,
            percentage: totalVotes > 0 ? Math.round((voteCounts[c.id] / totalVotes) * 100) : 0
        })).sort((a, b) => b.votes - a.votes);
        
        const isTied = resultCandidates.length >= 2 && resultCandidates[0].votes === resultCandidates[1].votes && resultCandidates[0].votes > 0;
        res.json({ candidates: resultCandidates, totalVotes, isTied });
    } catch (error) {
        console.error('Error fetching results:', error);
        res.json({ candidates: [], totalVotes: 0, isTied: false });
    }
});

app.post('/api/vote', async (req, res) => {
    const { email, candidateId, voteId } = req.body;
    if (!email || !candidateId) {
        return res.status(400).json({ success: false, message: 'Email and candidate required' });
    }
    
    // Normalize email to lowercase and trim
    const emailLower = email.toLowerCase().trim();
    
    try {
        // Check if already voted in Firebase - check BOTH /voters AND /votes
        const voters = await getAllVoters();
        const allVotes = await getAllVotes();
        
        // Check voters collection
        if (voters) {
            for (const key of Object.keys(voters)) {
                if (key.toLowerCase() === emailLower) {
                    const voter = voters[key];
                    return res.status(400).json({ success: false, message: 'Already voted', hasVoted: true, votedFor: voter.votedFor });
                }
            }
        }
        
        // Also check votes collection directly
        if (allVotes && Array.isArray(allVotes)) {
            for (const vote of allVotes) {
                if (vote.userEmail && vote.userEmail.toLowerCase() === emailLower) {
                    return res.status(400).json({ success: false, message: 'Already voted', hasVoted: true, votedFor: vote.candidateSymbol + ' ' + vote.candidateName });
                }
            }
        }
        
        const candidate = candidates.find(c => c.id === candidateId);
        if (!candidate) {
            return res.status(400).json({ success: false, message: 'Candidate not found' });
        }
        
        // Use the 8-digit voteId from frontend, or generate one if not provided
        const finalVoteId = voteId || Date.now().toString().slice(-8);
        
        // Save vote to Firebase
        const voteData = {
            id: finalVoteId,
            userEmail: emailLower,
            candidateId: candidate.id,
            candidateName: candidate.name,
            candidateDepartment: candidate.department,
            candidateSymbol: candidate.symbol,
            candidateSymbolName: candidate.symbolName,
            timestamp: new Date().toISOString(),
            timestampRaw: Date.now()
        };
        await saveVoteToFirebase(voteData);
        
        // Save voter to Firebase (using firebaseKey for proper key format)
        const firebaseKey = emailToFirebaseKey(emailLower);
        await saveVoterToFirebase(emailLower, {
            hasVoted: true,
            votedFor: candidate.symbol + ' ' + candidate.name,
            timestamp: new Date().toISOString()
        });
        
        const isTied = false; // Will be recalculated on results
        
        res.json({ success: true, message: 'Vote recorded!', voteId: finalVoteId, tie: isTied });
    } catch (error) {
        console.error('Error saving vote:', error);
        res.status(500).json({ success: false, message: 'Failed to save vote' });
    }
});

app.get('/api/check-vote/:email', async (req, res) => {
    try {
        const emailLower = req.params.email.toLowerCase().trim();
        
        const voters = await getAllVoters();
        const allVotes = await getAllVotes();
        
        // Check voters collection
        if (voters) {
            for (const key of Object.keys(voters)) {
                if (key.toLowerCase() === emailLower) {
                    const voter = voters[key];
                    return res.json({ hasVoted: true, votedFor: voter.votedFor });
                }
            }
        }
        
        // Also check votes collection directly
        if (allVotes && Array.isArray(allVotes)) {
            for (const vote of allVotes) {
                if (vote.userEmail && vote.userEmail.toLowerCase() === emailLower) {
                    return res.json({ hasVoted: true, votedFor: vote.candidateSymbol + ' ' + vote.candidateName });
                }
            }
        }
        
        res.json({ hasVoted: false });
    } catch (error) {
        console.error('Error checking vote:', error);
        res.json({ hasVoted: false });
    }
});

app.get('/api/admin/votes', async (req, res) => {
    try {
        const votes = await getAllVotes();
        res.json(votes);
    } catch (error) {
        console.error('Error fetching votes:', error);
        res.json([]);
    }
});

app.post('/api/casting-vote', (req, res) => {
    const { adminKey, candidateId } = req.body;
    if (adminKey !== 'admin2026casting') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    const candidate = candidates.find(c => c.id === candidateId);
    if (!candidate) {
        return res.status(400).json({ success: false, message: 'Candidate not found' });
    }
    res.json({ success: true, message: `Casting vote for ${candidate.name}`, winner: candidate });
});

// Admin endpoint to reset all votes
app.post('/api/admin/reset-votes', async (req, res) => {
    const { adminKey } = req.body;
    if (adminKey !== 'admin2026') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    
    try {
        // Delete all votes from Firebase
        await firebaseRequest('DELETE', '/votes');
        // Note: We do NOT delete voters collection to preserve admin user data
        
        res.json({ success: true, message: 'All votes have been reset' });
    } catch (error) {
        console.error('Error resetting votes:', error);
        res.status(500).json({ success: false, message: 'Failed to reset votes' });
    }
});

// API endpoint for user login
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password required' });
    }
    
    const emailLower = email.toLowerCase().trim();
    
    // Check admin credentials
    if (emailLower === 'admin@ice.edu' && password === 'admin2026') {
        return res.json({ 
            success: true, 
            user: { 
                id: 1, 
                name: 'Administrator', 
                email: emailLower, 
                role: 'admin' 
            } 
        });
    }
    
    try {
        // Check if user exists in registeredUsers
        const registeredUsersData = await firebaseRequest('GET', '/registeredUsers');
        const firebaseKey = emailToFirebaseKey(emailLower);
        
        if (registeredUsersData && registeredUsersData[firebaseKey]) {
            const user = registeredUsersData[firebaseKey];
            
            // Check password
            if (user.password === password) {
                // Check if already voted
                const voters = await getAllVoters();
                const hasVoted = voters && voters[firebaseKey];
                const votedFor = hasVoted ? voters[firebaseKey].votedFor : null;
                
                return res.json({
                    success: true,
                    user: {
                        id: user.id || Date.now(),
                        name: user.name || emailLower.split('@')[0],
                        email: emailLower,
                        role: 'voter',
                        hasVoted: hasVoted || false,
                        votedFor: votedFor
                    }
                });
            } else {
                return res.status(400).json({ success: false, message: 'Incorrect password' });
            }
        }
        
        // Check if user already voted (can login with default password if not registered)
        const voters = await getAllVoters();
        const hasVoted = voters && voters[firebaseKey];
        const votedFor = hasVoted ? voters[firebaseKey].votedFor : null;
        
        // Allow login with default password for users who haven't registered but want to vote
        if (password === 'voter123') {
            return res.json({
                success: true,
                user: {
                    id: Date.now(),
                    name: emailLower.split('@')[0],
                    email: emailLower,
                    role: 'voter',
                    hasVoted: hasVoted || false,
                    votedFor: votedFor
                }
            });
        }
        
        // User not found
        return res.status(400).json({ success: false, message: 'Not registered. Please register first.' });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Login failed' });
    }
});

// API endpoint for user registration
app.post('/api/register', async (req, res) => {
    const { email, name, studentId, department, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password required' });
    }
    
    const emailLower = email.toLowerCase().trim();
    const firebaseKey = emailToFirebaseKey(emailLower);
    
    try {
        // Check if user already exists in registeredUsers
        const registeredUsersData = await firebaseRequest('GET', '/registeredUsers');
        if (registeredUsersData && registeredUsersData[firebaseKey]) {
            return res.status(400).json({ success: false, message: 'Email already registered' });
        }
        
        // Also check if user has already voted
        const voters = await getAllVoters();
        if (voters && voters[firebaseKey]) {
            return res.status(400).json({ success: false, message: 'This email has already voted. Cannot register again.' });
        }
        
        // Save to Firebase registeredUsers node
        const result = await firebaseRequest('PUT', '/registeredUsers/' + firebaseKey, {
            email: emailLower,
            name: name,
            studentId: studentId,
            department: department,
            password: password,
            registeredAt: new Date().toISOString()
        });
        
        if (result === null) {
            console.error('Failed to save user to Firebase');
            return res.status(500).json({ success: false, message: 'Registration failed - could not save to database' });
        }
        
        res.json({ success: true, message: 'Registration successful' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: 'Registration failed' });
    }
});

// API endpoint to get user info
app.get('/api/user/:email', async (req, res) => {
    try {
        const emailLower = req.params.email.toLowerCase().trim();
        const registeredUsersData = await firebaseRequest('GET', '/registeredUsers');
        if (registeredUsersData && registeredUsersData[emailLower]) {
            res.json({ exists: true, user: registeredUsersData[emailLower] });
        } else {
            res.json({ exists: false });
        }
    } catch (error) {
        console.error('Error getting user:', error);
        res.json({ exists: false });
    }
});

// Admin endpoint to delete a specific user's registration
app.delete('/api/admin/user/:email', async (req, res) => {
    const { adminKey } = req.query;
    if (adminKey !== 'admin2026') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    
    const emailLower = req.params.email.toLowerCase().trim();
    
    try {
        await firebaseRequest('DELETE', '/registeredUsers/' + emailLower);
        res.json({ success: true, message: 'User registration deleted' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ success: false, message: 'Failed to delete user' });
    }
});

// Admin endpoint to delete a user's vote (allows them to vote again)
app.delete('/api/admin/vote/:email', async (req, res) => {
    const { adminKey } = req.query;
    if (adminKey !== 'admin2026') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    
    const emailLower = req.params.email.toLowerCase().trim();
    
    try {
        // Delete from voters node
        await firebaseRequest('DELETE', '/voters/' + emailLower);
        
        // Also delete from votes node
        const allVotes = await getAllVotes();
        const voteToDelete = allVotes.find(v => v.userEmail && v.userEmail.toLowerCase() === emailLower);
        
        if (voteToDelete) {
            await firebaseRequest('DELETE', '/votes/' + voteToDelete.id);
        }
        
        res.json({ success: true, message: 'Vote deleted - user can vote again' });
    } catch (error) {
        console.error('Error deleting vote:', error);
        res.status(500).json({ success: false, message: 'Failed to delete vote' });
    }
});

// Admin endpoint to delete both user registration and vote
app.delete('/api/admin/reset-user/:email', async (req, res) => {
    const { adminKey } = req.query;
    if (adminKey !== 'admin2026') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    
    const emailLower = req.params.email.toLowerCase().trim();
    
    try {
        await firebaseRequest('DELETE', '/registeredUsers/' + emailLower);
        await firebaseRequest('DELETE', '/voters/' + emailLower);
        
        const allVotes = await getAllVotes();
        const voteToDelete = allVotes.find(v => v.userEmail && v.userEmail.toLowerCase() === emailLower);
        
        if (voteToDelete) {
            await firebaseRequest('DELETE', '/votes/' + voteToDelete.id);
        }
        
        res.json({ success: true, message: 'User and vote data deleted - user can register and vote again' });
    } catch (error) {
        console.error('Error resetting user:', error);
        res.status(500).json({ success: false, message: 'Failed to reset user data' });
    }
});

// Serve static files - Vercel handles this via vercel.json
// For local development, use express.static
if (process.env.VERCEL === undefined) {
    app.use(express.static(path.join(__dirname, '.')));
}

// Handle SPA routing - Vercel handles this via vercel.json
app.get('*', (req, res) => {
    // For API requests that don't match, return 404
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    // For other requests, send index.html
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server (for local development)
if (process.env.VERCEL === undefined) {
    app.listen(PORT, () => {
        console.log(`UniVote server running on http://localhost:${PORT}`);
    });
}

// Export for Vercel
module.exports = app;

module.exports = app;
