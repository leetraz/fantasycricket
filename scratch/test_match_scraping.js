const axios = require('axios');
const cheerio = require('cheerio');

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

async function test() {
    try {
        const url = "https://www.espncricinfo.com/series/county-championship-division-one-2026-1513323/essex-vs-leicestershire-26th-match-1513351/full-scorecard";
        const r = await axios.get(url, axiosConfig);
        const $ = cheerio.load(r.data);
        const scriptData = $("#__NEXT_DATA__").html();
        if (!scriptData) return;
        const json = JSON.parse(scriptData);
        let data = json.props?.appPageProps?.data || json.props?.pageProps?.data || json.props?.appPageProps || json.props?.pageProps;
        if (data.data && !data.teamPlayers && !data.content) data = data.data;

        let teamPlayers = data.teamPlayers || 
                          data.content?.matchPlayers?.teamPlayers || 
                          data.matchData?.teamPlayers || 
                          data.match?.teams || [];
        if (data.content?.matchPlayers?.teamPlayers) teamPlayers = data.content.matchPlayers.teamPlayers;

        teamPlayers.forEach(t => {
            console.log("Team:", t.team?.name, "ID:", t.team?.objectId || t.team?.id);
        });
    } catch (e) {
        console.error(e.message);
    }
}

test();
