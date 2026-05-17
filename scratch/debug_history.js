const axios = require('axios');
const cheerio = require('cheerio');

const axiosConfig = {
    headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    }
};

async function fetchPlayerHistory(pid, name) {
    const fetchLog = async (type) => {
        const url = `https://stats.espncricinfo.com/ci/engine/player/${pid}.html?class=6;template=results;type=${type};view=match`;
        console.log(`Fetching: ${url}`);
        try {
            const r = await axios.get(url, axiosConfig);
            const $ = cheerio.load(r.data);
            
            // Log all tables found
            console.log(`Found ${$("table.engineTable").length} engine tables`);
            
            // More robust table detection: look for the table containing relevant headers
            let table = null;
            $("table.engineTable").each((i, t) => {
                const headerText = $(t).find("tr.headlinks th, tr.head th, thead tr th").text().toLowerCase();
                if ((type === 'batting' && headerText.includes("runs")) || 
                    (type === 'bowling' && headerText.includes("wkts")) ||
                    headerText.includes("opposition")) {
                    table = $(t);
                }
            });

            if (!table || !table.length) {
                console.log(`No suitable table found for ${type}`);
                return {};
            }

            let headers = [];
            table.find("tr.headlinks th, tr.head th, thead tr th").each((i, h) => headers.push($(h).text().trim().toLowerCase()));
            console.log(`Headers for ${type}:`, headers);
            
            const idx = {
                runs: headers.indexOf("runs"),
                wkts: headers.indexOf("wkts"),
                sr: headers.indexOf("sr"),
                econ: headers.indexOf("econ"),
                opp: headers.findIndex(h => h.includes("opposition")),
                date: headers.findIndex(h => h.includes("date"))
            };
            console.log(`Indices for ${type}:`, idx);

            let results = {};
            table.find("tr.data1").each((i, el) => {
                const cols = $(el).find("td").toArray().map(c => $(c).text().trim());
                if (cols.length < 5) return;
                
                const dateStr = idx.date !== -1 ? cols[idx.date] : "";
                const oppStr = idx.opp !== -1 ? cols[idx.opp] : "";
                if (!dateStr || dateStr === '0') return;

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
            console.log(`Found ${Object.keys(results).length} rows for ${type}`);
            return results;
        } catch (e) {
            console.error(`Error fetching ${type} log for ${pid}:`, e.message);
            return {};
        }
    };

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
    return Object.values(merged).sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
}

// Test with Virat Kohli (pid 253802)
fetchPlayerHistory('253802', 'Virat Kohli').then(res => {
    console.log(JSON.stringify(res, null, 2));
});
