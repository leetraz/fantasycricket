const axios = require('axios');
const cheerio = require('cheerio');

async function inspectPlayerHistory() {
    const url = "https://www.espncricinfo.com/cricketers/virat-kohli-253802/match-log";
    try {
        const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(res.data);
        const rows = $("table.engineTable tbody tr").first();
        const cols = rows.find("td").toArray().map(c => $(c).text().trim());
        console.log("Player History Columns (First Row):");
        cols.forEach((c, i) => console.log(`${i}: ${c}`));
    } catch (e) {
        console.error(e);
    }
}

inspectPlayerHistory();
