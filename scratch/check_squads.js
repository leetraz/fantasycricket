const axios = require('axios');
const cheerio = require('cheerio');

const url = "https://www.espncricinfo.com/series/ipl-2026-1510719/royal-challengers-bengaluru-vs-sunrisers-hyderabad-1st-match-1527674/full-scorecard";
const axiosConfig = {
    headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "max-age=0",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1"
    }
};

async function test() {
    try {
        const r = await axios.get(url, axiosConfig);
        const $ = cheerio.load(r.data);
        const scriptData = $("#__NEXT_DATA__").html();
        const json = JSON.parse(scriptData);
        const data = json.props.appPageProps.data;
        
        console.log("Match Teams count:", data.match?.teams?.length);
        if (data.match?.teams) {
            data.match.teams.forEach(t => {
                console.log(`Team: ${t.team.name}, Squad players: ${t.players?.length}`);
            });
        }
    } catch (e) {
        console.error(e.message);
    }
}

test();
