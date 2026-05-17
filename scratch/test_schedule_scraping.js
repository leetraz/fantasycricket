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
        const url = "https://www.espncricinfo.com/live-cricket-match-schedule-fixtures?quick_class_id=t20";
        const r = await axios.get(url, axiosConfig);
        const $ = cheerio.load(r.data);
        const scriptData = $("#__NEXT_DATA__").html();
        if (!scriptData) {
            console.log("No __NEXT_DATA__ found");
            return;
        }

        const json = JSON.parse(scriptData);
        const matchesData = json.props?.appPageProps?.data?.data?.content?.matches || [];
        
        const matches = matchesData.map(m => ({
            title: `${m.teams?.[0]?.team?.abbreviation || m.teams?.[0]?.team?.name || 'T1'} vs ${m.teams?.[1]?.team?.abbreviation || m.teams?.[1]?.team?.name || 'T2'}`,
            series: m.series?.name || "T20 Match",
            status: m.statusText || "Upcoming",
            url: "https://www.espncricinfo.com" + (m.slug ? `/series/${m.series?.slug}-${m.series?.objectId}/${m.slug}-${m.objectId}/live-cricket-score` : ""),
            startTime: m.startTime
        })).filter(m => m.url.includes('match-'));

        console.log("Matches Count:", matches.length);
        console.log("Samples:", JSON.stringify(matches.slice(0, 5), null, 2));
    } catch (e) {
        console.error("Error:", e.message);
    }
}

test();
