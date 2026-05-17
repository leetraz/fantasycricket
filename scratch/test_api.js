const axios = require('axios');

async function testPlayerProfileApi() {
    // Test with Virat Kohli (pid: 253802)
    const url = "http://localhost:3000/api/player-profile?pid=253802&objectId=253802&name=Virat%20Kohli&opponent=SRH";
    console.log(`Testing API: ${url}`);
    
    try {
        const res = await axios.get(url);
        console.log("Status:", res.status);
        console.log("Data Sample (First Match):", JSON.stringify(res.data.last10[0], null, 2));
        
        const hasSR = res.data.last10.some(m => m.sr && m.sr !== "");
        const hasEcon = res.data.last10.some(m => m.econ && m.econ !== "");
        
        console.log("\nValidation Results:");
        console.log(`- Has Strike Rate: ${hasSR}`);
        console.log(`- Has Economy: ${hasEcon}`);
        
    } catch (e) {
        console.error("API Error:", e.message);
    }
}

testPlayerProfileApi();
