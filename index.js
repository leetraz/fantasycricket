const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { exec } = require('child_process');
const path = require('path');

const openBrowser = (url) => {
    const start = (process.platform == 'darwin' ? 'open' : process.platform == 'win32' ? 'start' : 'xdg-open');
    exec(start + ' ' + url);
};

const app = express();
const PORT = 3000;

// Serve static files with complete cache disabling (no-store, no-cache, etag false, maxAge 0) to prevent browser cache retention
app.use(express.static(path.join(__dirname, 'public'), {
    etag: false,
    maxAge: 0,
    setHeaders: (res, path) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    }
}));

// Redirect root to launcher
app.get('/', (req, res) => res.redirect('/launcher.html'));

// Headers for requests - Specially tuned to bypass Cricinfo's WAF (403 Forbidden) blocks
const axiosConfig = {
    headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Sec-Ch-Ua": '"Chromium";v="147", "Not.A/Brand";v="8"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Linux"',
        "Cache-Control": "max-age=0"
    },
    timeout: 30000
};

// ── Extract IDs from URL ──
function extractIds(url) {
    if (!url) return null;
    // Improved regex to handle various Cricinfo URL patterns
    const regex = /-(\d{5,9})(?:\/|-|$)/g;
    const matches = [...url.matchAll(regex)].map(m => m[1]);
    
    if (matches.length >= 2) {
        // Usually the last two IDs are series and match
        return { seriesId: matches[matches.length - 2], matchId: matches[matches.length - 1] };
    }
    if (matches.length === 1) return { seriesId: matches[0], matchId: matches[0] };
    return null;
}

// ── Fetch JSON via __NEXT_DATA__ ──
async function fetchNextData(url) {
    try {
        console.log(`FETCHING: ${url}`);
        const r = await axios.get(url, axiosConfig);
        const $ = cheerio.load(r.data);
        const scriptData = $("#__NEXT_DATA__").html();
        if (!scriptData) return null;
        return JSON.parse(scriptData);
    } catch (e) {
        console.error(`SCRAPE_ERROR [${url}]: ${e.message}`);
        return null;
    }
}

// Recursive helper to find any team squad container in the JSON structure
function findSquadsRecursively(obj, squads = []) {
    if (!obj || typeof obj !== 'object') return squads;
    
    // Check if this object represents a team with players
    if (obj.team && (obj.players || obj.player || obj.squad || obj.squadPlayers) && Array.isArray(obj.players || obj.player || obj.squad || obj.squadPlayers)) {
        squads.push(obj);
    }
    
    // Recurse into all keys
    for (let key in obj) {
        if (obj.hasOwnProperty(key) && obj[key] && typeof obj[key] === 'object') {
            findSquadsRecursively(obj[key], squads);
        }
    }
    return squads;
}

// Get team players array dynamically and securely
function getTeamPlayers(data) {
    if (!data) return [];
    let list = data.teamPlayers || 
               data.content?.matchPlayers?.teamPlayers || 
               data.matchData?.teamPlayers || 
               data.match?.teams || 
               data.squads || 
               data.content?.squads || [];
               
    if (data.content?.matchPlayers?.teamPlayers) list = data.content.matchPlayers.teamPlayers;
    
    if (!list || !list.length) {
        list = findSquadsRecursively(data);
    }
    return list;
}

// ── Parse Playing XI ──
function parsePlayingXi(data) {
    const teamPlayers = getTeamPlayers(data);
    const players = [];
    const seen = new Set();

    teamPlayers.forEach(t => {
        const teamName = t.team?.abbreviation || t.team?.name || t.team_short_name || t.team_abbreviation || "Team";
        const playerList = t.player || t.players || t.squad || t.squadPlayers || [];
        
        playerList.forEach(p => {
            const node = p.player || p;
            const pid = node.objectId || node.id || node.player_id;
            if (!pid || seen.has(pid)) return;
            seen.add(pid);

            const isBench = p.isSub || p.substitute || p.role === 'substitute' || node.isSub || p.isBench || node.isBench || false;
            if (isBench) return;

            players.push({
                name: node.longName || node.name || node.fullName || "Unknown",
                team: teamName,
                player_id: pid,
                object_id: pid,
                role: node.playingRole?.name || node.role || "Player",
                playingXI: p.playingXI || p.isPlay || node.isPlay || p.isPlaying || node.isPlaying || false
            });
        });
    });

    const teams = [...new Set(players.map(p => p.team))];
    let filteredPlayers = [];
    
    teams.forEach(teamName => {
        const teamList = players.filter(p => p.team === teamName);
        const hasAnnouncedXI = teamList.some(p => p.playingXI === true);
        
        if (hasAnnouncedXI) {
            filteredPlayers.push(...teamList.filter(p => p.playingXI === true));
        } else {
            filteredPlayers.push(...teamList);
        }
    });

    return filteredPlayers.map(p => ({
        name: p.name,
        team: p.team,
        player_id: p.player_id,
        object_id: p.object_id,
        role: p.role
    }));
}

// ── API: List Live/Upcoming Matches ──
app.get('/api/list-matches', async (req, res) => {
    try {
        const url = "https://www.espncricinfo.com/live-cricket-match-schedule-fixtures?quick_class_id=t20";
        const json = await fetchNextData(url);
        if (!json) return res.json([]);

        const matchesData = json.props?.appPageProps?.data?.data?.content?.matches || 
                           json.props?.appPageProps?.data?.content?.matches || 
                           json.props?.appPageProps?.matchScheduleData?.content?.matches || 
                           json.props?.pageProps?.matchScheduleData?.content?.matches || [];

        const matches = matchesData.filter(m => {
            const statusText = (m.statusText || '').toLowerCase();
            const state = (m.state || '').toLowerCase();
            
            // Toss done: status contains toss / chose to / elected to / opted to
            const tossDone = statusText.includes('toss') || statusText.includes('chose to') || statusText.includes('elected to') || statusText.includes('opted to');
            
            // Not playing yet / not live / not completed
            const upcoming = state === 'pre' && !statusText.includes('match started') && !statusText.includes('won by') && !statusText.includes('abandoned');
            
            return tossDone && upcoming;
        }).map(m => ({
            title: `${m.teams?.[0]?.team?.abbreviation || 'T1'} vs ${m.teams?.[1]?.team?.abbreviation || 'T2'}`,
            series: m.series?.name || "T20 Match",
            status: m.statusText || "Upcoming",
            url: "https://www.espncricinfo.com" + (m.slug ? `/series/${m.slug}-${m.series?.objectId}/${m.slug}-${m.objectId}/live-cricket-score` : ""),
            startTime: m.startTime
        })).filter(m => m.url.includes('match-'));

        res.json(matches.slice(0, 30));
    } catch (e) {
        res.json([]);
    }
});

// ── API: Match Data ──
app.get('/api/match-data', async (req, res) => {
    const matchUrl = req.query.url;
    if (!matchUrl) return res.status(400).json({ error: "No URL" });

    try {
        const json = await fetchNextData(matchUrl);
        if (!json) throw new Error("Failed to load match page");

        let data = json.props?.appPageProps?.data || json.props?.pageProps?.data || json.props?.appPageProps || json.props?.pageProps;
        if (data && data.data && !data.teamPlayers && !data.content) data = data.data;

        const players = parsePlayingXi(data);
        if (!players.length) throw new Error("Playing XI not found");

        const teamNames = [...new Set(players.map(p => p.team))];
        
        const teamPlayers = getTeamPlayers(data);

        const teamsInfo = teamPlayers.map(t => ({
            name: t.team?.abbreviation || t.team?.name || t.team_short_name || t.team_abbreviation || "Team",
            id: t.team?.objectId || t.team?.id
        }));

        const matchInfo = data.matchInfo || data.content?.matchInfo || {};
        const statusText = data.matchData?.statusText || matchInfo.statusText || data.statusText || "";

        res.json({
            allPlayers: players,
            teams: teamNames,
            teamsInfo: teamsInfo,
            statusText: statusText
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const teamMap = {
    'CSK': 4340, 'MI': 4341, 'RCB': 4342, 'KKR': 4343, 
    'DC': 4344, 'PBKS': 4345, 'RR': 4346, 'SRH': 4433, 
    'GT': 6904, 'LSG': 6903
};

function getTeamId(name) {
    const upper = (name || "").toUpperCase();
    for (let [abbr, id] of Object.entries(teamMap)) {
        if (upper === abbr || upper.includes(abbr)) return id;
    }
    const names = {
        'CHENNAI': 4340, 'MUMBAI': 4341, 'BANGALORE': 4342, 'KOLKATA': 4343,
        'DELHI': 4344, 'PUNJAB': 4345, 'RAJASTHAN': 4346, 'HYDERABAD': 4433,
        'GUJARAT': 6904, 'LUCKNOW': 6903
    };
    for (let [key, val] of Object.entries(names)) {
        if (upper.includes(key)) return val;
    }
    return null;
}

// ── API: H2H Match History ──
app.get('/api/h2h-match-history', async (req, res) => {
    const { team1Id, team2Id } = req.query;

    if (!team1Id || !team2Id) return res.json([]);

    try {
        const url = `https://stats.espncricinfo.com/ci/engine/team/${team1Id}.html?class=6;template=results;type=team;view=results;opposition=${team2Id}`;
        const r = await axios.get(url, axiosConfig);
        const $ = cheerio.load(r.data);
        
        const matches = [];
        $("table.engineTable").each((i, t) => {
            const head = $(t).find("tr.headlinks").text().toLowerCase();
            if (head.includes("match") && head.includes("date")) {
                $(t).find("tr.data1").each((j, el) => {
                    const cols = $(el).find("td");
                    const matchNode = $(cols[0]);
                    const matchName = matchNode.text().trim();
                    const matchLink = matchNode.find("a").attr("href");
                    
                    if (matchLink) {
                        const matchId = matchLink.split('/').pop().split('.')[0];
                        matches.push({
                            title: matchName,
                            result: $(cols[1]).text().trim(),
                            score: $(cols[2]).text().trim(),
                            ground: $(cols[3]).text().trim(),
                            date: $(cols[4]).text().trim(),
                            url: `https://www.espncricinfo.com/series/match-${matchId}/full-scorecard`
                        });
                    }
                });
            }
        });

        res.json(matches.reverse().slice(0, 15));
    } catch (e) {
        res.json([]);
    }
});

// ── API: Player Profile (Scrape Statsguru batting/bowling log) ──
app.get('/api/player-profile', async (req, res) => {
    const { pid, name } = req.query;
    if (!pid) return res.status(400).json({ error: "Missing player ID" });

    const fetchLog = async (type) => {
        const url = `https://stats.espncricinfo.com/ci/engine/player/${pid}.html?class=6;template=results;type=${type};view=match`;
        try {
            const r = await axios.get(url, axiosConfig);
            const $ = cheerio.load(r.data);
            
            let table = null;
            $("table.engineTable").each((i, t) => {
                const headerText = $(t).find("tr.headlinks th, tr.head th, thead tr th").text().toLowerCase();
                if ((type === 'batting' && headerText.includes("runs")) || 
                    (type === 'bowling' && headerText.includes("wkts")) ||
                    headerText.includes("opposition")) {
                    table = $(t);
                }
            });

            if (!table || !table.length) return {};

            let headers = [];
            table.find("tr.headlinks th, tr.head th, thead tr th").each((i, h) => headers.push($(h).text().trim().toLowerCase()));
            
            const idx = {
                runs: headers.indexOf("runs"),
                wkts: headers.indexOf("wkts"),
                sr: headers.indexOf("sr"),
                econ: headers.indexOf("econ"),
                opp: headers.findIndex(h => h.includes("opposition")),
                date: headers.findIndex(h => h.includes("date"))
            };

            let results = {};
            table.find("tr.data1").each((i, el) => {
                const cols = $(el).find("td").toArray().map(c => $(c).text().trim());
                if (cols.length < 5) return;
                
                const dateStr = idx.date !== -1 ? cols[idx.date] : "";
                const oppStr = idx.opp !== -1 ? cols[idx.opp] : "";
                if (!dateStr || dateStr === '0') return;

                // Exclude matches played today or in the future to keep only completed matches
                const matchDateObj = new Date(dateStr);
                const todayObj = new Date();
                todayObj.setHours(0,0,0,0);
                if (matchDateObj >= todayObj) return; // skip live or upcoming matches

                const date = new Date(dateStr).toLocaleDateString();
                const key = `${oppStr.replace(/^v\s+/, '').trim()}|${date}`;
                
                results[key] = {
                    opp: oppStr.replace(/^v\s+/, '').trim(),
                    date: date,
                    timestamp: new Date(dateStr).getTime(),
                    [type === 'batting' ? 'bat' : 'bowl']: type === 'batting' ? cols[idx.runs] : cols[idx.wkts],
                    [type === 'batting' ? 'sr' : 'econ']: type === 'batting' ? cols[idx.sr] : cols[idx.econ]
                };
            });
            return results;
        } catch (e) {
            return {};
        }
    };

    try {
        const batData = await fetchLog('batting');
        const bowlData = await fetchLog('bowling');
        
        let merged = { ...batData };
        for (const [key, data] of Object.entries(bowlData)) {
            if (merged[key]) {
                merged[key] = { ...merged[key], ...data };
            } else {
                merged[key] = data;
            }
        }
        
        const sorted = Object.values(merged).sort((a, b) => b.timestamp - a.timestamp);
        res.json({
            last10: sorted
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
    openBrowser(`http://localhost:${PORT}/`);
});
