const axios = require('axios');
const cheerio = require('cheerio');

const url = "https://www.espncricinfo.com/series/ipl-2026-1510719/royal-challengers-bengaluru-vs-sunrisers-hyderabad-1st-match-1527674/full-scorecard";
const axiosConfig = {
    headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    }
};

async function test() {
    try {
        const r = await axios.get(url, axiosConfig);
        const $ = cheerio.load(r.data);
        const scriptData = $("#__NEXT_DATA__").html();
        const json = JSON.parse(scriptData);
        const data = json.props.appPageProps.data;
        
        console.log("Keys in data:", Object.keys(data));
        if (data.content) console.log("Keys in data.content:", Object.keys(data.content));
        
        // Look for squad or players
        function findPlayers(obj, path = "") {
            if (!obj || typeof obj !== 'object') return;
            if (Array.isArray(obj)) {
                if (obj.length > 0 && (obj[0].player || obj[0].objectId)) {
                    console.log(`Found potential players array at: ${path} (length: ${obj.length})`);
                }
                obj.forEach((item, i) => findPlayers(item, `${path}[${i}]`));
            } else {
                for (let k in obj) {
                    if (k === 'players' || k === 'player' || k === 'teamPlayers') {
                         console.log(`Found key '${k}' at: ${path}.${k}`);
                    }
                    findPlayers(obj[k], `${path}.${k}`);
                }
            }
        }
        
        findPlayers(data, "data");
    } catch (e) {
        console.error(e.message);
    }
}

test();
