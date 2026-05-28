const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const openBrowser = (url) => {
    const start = (process.platform == 'darwin' ? 'open' : process.platform == 'win32' ? 'start' : 'xdg-open');
    exec(start + ' ' + url);
};

const app = express();
const PORT = 3000;
const playerGenderMap = new Map();

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

    // Determine if starting XI has been announced by checking if any player is explicitly marked as playing
    let xiAnnounced = false;
    teamPlayers.forEach(t => {
        const playerList = t.player || t.players || t.squad || t.squadPlayers || [];
        playerList.forEach(p => {
            const node = p.player || p;
            if (p.playingXI || p.isPlay || node.isPlay || p.isPlaying || node.isPlaying) {
                xiAnnounced = true;
            }
        });
    });

    teamPlayers.forEach(t => {
        const teamName = t.team?.abbreviation || t.team?.name || t.team_short_name || t.team_abbreviation || "Team";
        const playerList = t.player || t.players || t.squad || t.squadPlayers || [];
        
        playerList.forEach(p => {
            const node = p.player || p;
            const pid = node.objectId || node.id || node.player_id;
            if (!pid || seen.has(pid)) return;
            seen.add(pid);
            playerGenderMap.set(parseInt(pid), node.gender || node.player?.gender || "M");

            const isPlayingXI = p.playingXI || p.isPlay || node.isPlay || p.isPlaying || node.isPlaying || false;
            const isSub = p.isSub || p.substitute || node.isSub || p.role === 'substitute' || false;
            
            // Only filter out pure bench players if the starting XI has been announced
            if (xiAnnounced) {
                const isPureBench = p.isBench || node.isBench || (!isPlayingXI && !isSub);
                if (isPureBench) return;
            }

            players.push({
                name: node.longName || node.name || node.fullName || "Unknown",
                team: teamName,
                player_id: pid,
                object_id: pid,
                role: (node.playingRoles && node.playingRoles.length > 0) ? node.playingRoles[0] : (node.playingRole?.name || node.role || "Player"),
                playingXI: isPlayingXI,
                isSub: isSub
            });
        });
    });

    const teams = [...new Set(players.map(p => p.team))];
    let filteredPlayers = [];
    
    teams.forEach(teamName => {
        const teamList = players.filter(p => p.team === teamName);
        const hasAnnouncedXI = teamList.some(p => p.playingXI === true);
        
        if (hasAnnouncedXI) {
            // Push starting playing XI AND active substitutes, exclude non-playing bench
            filteredPlayers.push(...teamList.filter(p => p.playingXI === true || p.isSub === true));
        } else {
            filteredPlayers.push(...teamList);
        }
    });

    return filteredPlayers.map(p => ({
        name: p.name,
        team: p.team,
        player_id: p.player_id,
        object_id: p.object_id,
        role: p.role,
        isSub: p.isSub || false
    }));
}

// ── Global Match Playing XI Availability Cache ──
const matchXiCache = new Map();

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

        const candidateMatches = matchesData.filter(m => {
            const statusText = (m.statusText || '').toLowerCase();
            const state = (m.state || '').toLowerCase();
            
            // Exclude completely finished/cancelled matches
            const completed = state === 'post' || statusText.includes('won by') || statusText.includes('abandoned') || statusText.includes('no result');
            
            // Exclude already started matches
            const alreadyStarted = state === 'live' || statusText.includes('match started') || statusText.includes('lead by') || statusText.includes('trail by') || statusText.includes('day ') || statusText.includes('overs');
            
            if (completed || alreadyStarted) return false;
            
            // Must be upcoming/pre-match (includes tossed but not yet started)
            if (state !== 'pre') return false;

            // Check if starting within next 24 hours (a couple of hours / today)
            if (m.startTime) {
                const now = new Date();
                const matchTime = new Date(m.startTime);
                const diffHours = (matchTime - now) / (1000 * 60 * 60);
                // Must start in the near future/recently scheduled start, and within 24 hours
                return diffHours >= -0.5 && diffHours <= 24;
            }
            
            return true;
        }).map(m => {
            const statusText = (m.statusText || '').toLowerCase();
            const state = (m.state || '').toLowerCase();
            const tossDone = statusText.includes('toss') || statusText.includes('chose to') || statusText.includes('elected to') || statusText.includes('opted to');
            
            let status = m.statusText || "Upcoming";
            if (status.includes("{{MATCH_START_HOURS}}") || status.includes("{{MATCH_START_MINS}}")) {
                if (m.startTime) {
                    const diffMs = new Date(m.startTime) - new Date();
                    if (diffMs > 0) {
                        const totalMins = Math.floor(diffMs / (1000 * 60));
                        const hours = Math.floor(totalMins / 60);
                        const mins = totalMins % 60;
                        
                        let hourText = hours > 0 ? `${hours} hr` : "";
                        let minText = `${mins} min`;
                        let timeStr = hourText ? `${hourText} ${minText}` : minText;
                        
                        status = `Match starts in ${timeStr}`;
                    } else {
                        status = "Match starting soon";
                    }
                } else {
                    status = "Match starts soon";
                }
            }

            return {
                title: `${m.teams?.[0]?.team?.abbreviation || 'T1'} vs ${m.teams?.[1]?.team?.abbreviation || 'T2'}`,
                series: m.series?.name || "T20 Match",
                status: status,
                url: "https://www.espncricinfo.com" + (m.slug ? `/series/${m.slug}-${m.series?.objectId}/${m.slug}-${m.objectId}/live-cricket-score` : ""),
                startTime: m.startTime,
                tossDone: tossDone,
                state: state
            };
        }).filter(m => m.url.includes('match-') || m.url.includes('live-cricket') || m.url.includes('scorecard'));

        const verifiedMatches = [];
        await Promise.all(candidateMatches.map(async (m) => {
            const cacheKey = m.url;
            if (matchXiCache.has(cacheKey)) {
                const cached = matchXiCache.get(cacheKey);
                if (cached.available) {
                    verifiedMatches.push(m);
                    return;
                } else {
                    // Check if negative cache expired (5 minutes TTL)
                    if (Date.now() - cached.timestamp < 5 * 60 * 1000) {
                        return;
                    }
                }
            }

            try {
                const matchJson = await fetchNextData(m.url);
                if (matchJson) {
                    let data = matchJson.props?.appPageProps?.data || matchJson.props?.pageProps?.data || matchJson.props?.appPageProps || matchJson.props?.pageProps;
                    if (data && data.data && !data.teamPlayers && !data.content) data = data.data;
                    const players = parsePlayingXi(data);
                    if (players && players.length > 0) {
                        matchXiCache.set(cacheKey, { available: true, timestamp: Date.now() });
                        verifiedMatches.push(m);
                        return;
                    }
                }
            } catch (err) {
                // Ignore match
            }
            matchXiCache.set(cacheKey, { available: false, timestamp: Date.now() });
        }));

        // Sort verified matches chronologically (earliest first)
        verifiedMatches.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

        res.json(verifiedMatches.slice(0, 30));
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
        const matchDetail = data.match || data.matchDetail || {};
        const statusText = matchDetail.statusText || data.matchData?.statusText || matchInfo.statusText || data.statusText || "";
        const groundName = matchDetail.ground?.name || data.matchData?.ground?.name || matchInfo.ground?.name || data.groundName || "";

        res.json({
            allPlayers: players,
            teams: teamNames,
            teamsInfo: teamsInfo,
            statusText: statusText,
            groundName: groundName
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

let playerCache = new Map(); // pid -> { timestamp, data }
try {
    if (fs.existsSync('player_cache.json')) {
        const raw = fs.readFileSync('player_cache.json', 'utf8');
        const parsed = JSON.parse(raw);
        playerCache = new Map(Object.entries(parsed));
        console.log(`[Cache] Loaded ${playerCache.size} player profiles from persistent cache.`);
    }
} catch (err) {
    console.error(`[Cache Error] Failed to load persistent cache: ${err.message}`);
}
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours caching for absolute WAF stability

// ── API: Player Profile (Scrape Statsguru batting/bowling log) ──
app.get('/api/player-profile', async (req, res) => {
    const { pid, name } = req.query;
    if (!pid) return res.status(400).json({ error: "Missing player ID" });

    const cached = playerCache.get(pid);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
        return res.json(cached.data);
    }

    try {
        let results = {};
        let success = false;

        // ── METHOD 1: Direct modern player matches page scraper (Exhaustive & WAF-bypassed) ──
        try {
            const cleanName = (name || 'player').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const url = `https://www.espncricinfo.com/cricketers/${cleanName}-${pid}/matches`;
            console.log(`[Scraper] Trying direct matches scraper: ${url}`);
            
            const r = await axios.get(url, axiosConfig);
            const $ = cheerio.load(r.data);
            
            // Dynamically detect column indices from table header to prevent shifting issues
            let colMap = { match: 0, bat: 1, bowl: 2, date: 3, ground: 4 };
            let headerRowEl = $("table thead tr").first();
            if (headerRowEl.length === 0) {
                headerRowEl = $("table tr").first();
            }
            const headers = headerRowEl.find("th, td").toArray().map(h => $(h).text().trim().toLowerCase());
            if (headers.length > 0) {
                const matchIdx = headers.findIndex(h => h.includes("match"));
                const batIdx = headers.findIndex(h => h.includes("bat"));
                const bowlIdx = headers.findIndex(h => h.includes("bowl"));
                const dateIdx = headers.findIndex(h => h.includes("date"));
                const groundIdx = headers.findIndex(h => h.includes("ground"));

                if (matchIdx !== -1) colMap.match = matchIdx;
                if (batIdx !== -1) colMap.bat = batIdx;
                colMap.bowl = bowlIdx; // Note: Can be -1 if missing
                if (dateIdx !== -1) colMap.date = dateIdx;
                if (groundIdx !== -1) colMap.ground = groundIdx;
            }

            const rows = $("table tbody tr");
            if (rows.length > 0) {
                rows.each((i, el) => {
                    const cols = $(el).find("td").toArray().map(c => $(c).text().trim());
                    if (cols.length < Math.max(colMap.match, colMap.bat, colMap.date) + 1) return;
                    
                    const matchTitle = cols[colMap.match] || "";
                    const batVal = cols[colMap.bat] || "--";
                    const bowlVal = colMap.bowl !== -1 ? (cols[colMap.bowl] || "--") : "--";
                    const dateStr = cols[colMap.date] || "";
                    const ground = cols[colMap.ground] || "";

                    if (!dateStr || dateStr === '0') return;

                    // Clean opposition team name
                    let opp = matchTitle;
                    if (matchTitle.includes(" vs ")) {
                        const parts = matchTitle.split(" vs ");
                        const part0Lower = parts[0].toLowerCase();
                        // Filter out common own team prefixes
                        if (part0Lower.includes("sco") || part0Lower.includes("scot") || part0Lower.includes("india") || part0Lower.includes("ind")) {
                            opp = parts[1].trim();
                        } else {
                            opp = parts[0].trim();
                        }
                    }

                    // Format date
                    const dateObj = new Date(dateStr);
                    const dateFormatted = dateObj.toLocaleDateString();
                    const timestamp = dateObj.getTime();
                    
                    // Parse batting runs
                    let bat = "-";
                    if (batVal !== "--" && batVal !== "absent" && batVal !== "sub" && batVal !== "dnb" && batVal !== "tdnb") {
                        bat = batVal;
                    }

                    // Parse bowling wickets
                    let bowl = "-";
                    if (bowlVal !== "--" && bowlVal !== "-") {
                        if (bowlVal.includes("/")) {
                            bowl = bowlVal.split("/")[0].trim();
                        } else {
                            bowl = bowlVal.trim();
                        }
                    }

                    const key = `${opp}|${dateFormatted}`;
                    results[key] = {
                        opp,
                        date: dateFormatted,
                        timestamp,
                        ground,
                        bat,
                        sr: "-",
                        bowl,
                        econ: "-"
                    };
                });

                if (Object.keys(results).length > 0) {
                    console.log(`[Scraper] Direct matches scraper succeeded with ${Object.keys(results).length} matches!`);
                    success = true;
                }
            }
        } catch (err) {
            console.warn(`[Scraper Warn] Direct matches scraper failed: ${err.message}. Falling back to Statsguru.`);
        }

        // ── METHOD 2: Statsguru Fallback (If direct scraper fails or returns empty) ──
        if (!success) {
            console.log(`[Scraper] Launching Statsguru scraper fallback for pid=${pid}`);
            const fetchSingleLog = async (cls, type, retries = 2, delayMs = 300) => {
                const url = `https://stats.espncricinfo.com/ci/engine/player/${pid}.html?class=${cls};template=results;type=${type};view=match`;
                for (let attempt = 1; attempt <= retries + 1; attempt++) {
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
                            date: headers.findIndex(h => h.includes("date")),
                            ground: headers.indexOf("ground")
                        };

                        let resObj = {};
                        const rows = table.find("tr.data1");
                        if (rows.length === 0) return {};

                        rows.each((i, el) => {
                            const cols = $(el).find("td").toArray().map(c => $(c).text().trim());
                            if (cols.length < 5) return;
                            
                            const dateStr = idx.date !== -1 ? cols[idx.date] : "";
                            const oppStr = idx.opp !== -1 ? cols[idx.opp] : "";
                            if (!dateStr || dateStr === '0') return;

                            const matchDateObj = new Date(dateStr);
                            const todayObj = new Date();
                            todayObj.setHours(0,0,0,0);
                            if (matchDateObj >= todayObj) return;

                            const date = new Date(dateStr).toLocaleDateString();
                            const key = `${oppStr.replace(/^v\s+/, '').trim()}|${date}`;
                            
                            resObj[key] = {
                                opp: oppStr.replace(/^v\s+/, '').trim(),
                                date: date,
                                timestamp: new Date(dateStr).getTime(),
                                ground: idx.ground !== -1 ? cols[idx.ground] : "",
                                [type === 'batting' ? 'bat' : 'bowl']: type === 'batting' ? cols[idx.runs] : cols[idx.wkts],
                                [type === 'batting' ? 'sr' : 'econ']: type === 'batting' ? cols[idx.sr] : cols[idx.econ]
                            };
                        });
                        return resObj;
                    } catch (e) {
                        if (attempt <= retries) {
                            console.warn(`[Scraper Warn] Class ${cls} ${type} failed (Attempt ${attempt}/${retries + 1}): ${e.message}. Retrying in ${delayMs}ms...`);
                            await new Promise(res => setTimeout(res, delayMs));
                        } else {
                            console.error(`[Scraper Error] Class ${cls} ${type} failed completely after ${attempt} attempts: ${e.message}`);
                            return {};
                        }
                    }
                }
            };

            let gender = playerGenderMap.get(parseInt(pid));
            if (!gender) {
                const oppQuery = (req.query.opponent || "").toLowerCase();
                const nameQuery = (name || "").toLowerCase();
                if (oppQuery.includes("women") || oppQuery.includes("-w") || oppQuery.includes("wmn") ||
                    nameQuery.includes("women") || nameQuery.includes("wmn") || nameQuery.includes("fem")) {
                    gender = "F";
                } else {
                    gender = "M";
                }
            }
            const classes = gender === "F" ? [25, 22, 23, 10, 9, 8] : [22, 6, 3, 2, 1, 25, 23, 10, 9, 8];

            const batPromises = classes.map(cls => fetchSingleLog(cls, 'batting'));
            const bowlPromises = classes.map(cls => fetchSingleLog(cls, 'bowling'));

            const [batResultsArray, bowlResultsArray] = await Promise.all([
                Promise.all(batPromises),
                Promise.all(bowlPromises)
            ]);

            let mergedBat = {};
            batResultsArray.forEach(res => { mergedBat = { ...mergedBat, ...res }; });

            let mergedBowl = {};
            bowlResultsArray.forEach(res => { mergedBowl = { ...mergedBowl, ...res }; });

            // Fallback: If no records found at all, try the opposite gender classes
            if (Object.keys(mergedBat).length === 0 && Object.keys(mergedBowl).length === 0) {
                console.log(`[Scraper] Fallback: No matches found for class ${classes.join(",")}. Trying alternate gender formats.`);
                const fallbackClasses = gender === "F" ? [22, 6, 3, 2, 1] : [25, 22, 23, 10, 9, 8];
                
                const fallBatPromises = fallbackClasses.map(cls => fetchSingleLog(cls, 'batting'));
                const fallBowlPromises = fallbackClasses.map(cls => fetchSingleLog(cls, 'bowling'));

                const [fallBatResults, fallBowlResults] = await Promise.all([
                    Promise.all(fallBatPromises),
                    Promise.all(fallBowlPromises)
                ]);

                fallBatResults.forEach(res => { mergedBat = { ...mergedBat, ...res }; });
                fallBowlResults.forEach(res => { mergedBowl = { ...mergedBowl, ...res }; });
            }

            results = { ...mergedBat };
            for (const [key, data] of Object.entries(mergedBowl)) {
                if (results[key]) {
                    results[key] = { ...results[key], ...data };
                } else {
                    results[key] = data;
                }
            }
        }

        const sorted = Object.values(results).sort((a, b) => b.timestamp - a.timestamp);
        const responseData = { last10: sorted };
        playerCache.set(pid, { timestamp: Date.now(), data: responseData });
        try {
            fs.writeFileSync('player_cache.json', JSON.stringify(Object.fromEntries(playerCache), null, 2));
        } catch (err) {
            console.error(`[Cache Error] Failed to save persistent cache: ${err.message}`);
        }
        res.json(responseData);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
    openBrowser(`http://localhost:${PORT}/`);
});
