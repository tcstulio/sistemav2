
import axios from 'axios';
import https from 'https';

// --- CONFIGURATION ---
// Please fill in your Dolibarr details here
const API_URL = 'https://sistema.coolgroove.com.br/api/index.php';
const CUSTOM_SYNC_URL = 'https://sistema.coolgroove.com.br/custom_sync.php';
const API_KEY = process.env.DOLIBARR_API_KEY || ''; // set DOLIBARR_API_KEY in your environment
const TASK_ID = '718';

// Ignore self-signed certificate errors (common in dev/local environments)
const agent = new https.Agent({
    rejectUnauthorized: false
});

const axiosInstance = axios.create({
    httpsAgent: agent,
    headers: {
        'DOLAPIKEY': API_KEY
    }
});

async function compareTaskData() {
    console.log(`Analyzing Task ID: ${TASK_ID}`);
    console.log('--------------------------------------------------');

    try {
        // 1. Fetch from Standard API
        console.log(`[1] Fetching from Standard API: ${API_URL}/projects/tasks/${TASK_ID}`);
        let standardTask = null;
        try {
            // Try project tasks endpoint first
            const res1 = await axiosInstance.get(`${API_URL}/projects/tasks/${TASK_ID}`);
            standardTask = res1.data;
        } catch (e) {
            console.log("   (Standard API /projects/tasks failed, trying /tasks)");
            // Fallback to /tasks endpoint
            try {
                const res2 = await axiosInstance.get(`${API_URL}/tasks/${TASK_ID}`);
                standardTask = res2.data;
            } catch (innerE) {
                console.error("   Failed to fetch from Standard API:", (innerE as Error).message);
            }
        }

        if (standardTask) {
            console.log("   ✅ Standard API Data Received");
        }


        // 2. Fetch from Custom Sync
        // Custom sync usually takes type and last_modified. It doesn't fetch by ID directly usually.
        // We will fetch tasks and find the specific one.
        console.log(`[2] Fetching from Custom Sync: ${CUSTOM_SYNC_URL}?type=tasks&limit=5000`);
        let customTask = null;
        try {
            const resCustom = await axiosInstance.get(`${CUSTOM_SYNC_URL}`, {
                params: {
                    type: 'tasks',
                    last_modified: 0, // Fetch all (or recent)
                    DOLAPIKEY: API_KEY
                }
            });

            if (resCustom.data && Array.isArray(resCustom.data.data)) {
                const allTasks = resCustom.data.data;
                // Find the task with the matching ID
                customTask = allTasks.find((t: any) => String(t.id) === String(TASK_ID));

                if (customTask) {
                    console.log("   ✅ Custom Sync Data Received (Found in list)");
                } else {
                    console.warn(`   ⚠️ Task ${TASK_ID} not found in Custom Sync response (fetched ${allTasks.length} tasks)`);
                }
            } else {
                console.error("   ❌ Invalid Custom Sync response structure");
            }

        } catch (e) {
            console.error("   Failed to fetch from Custom Sync:", (e as Error).message);
        }

        console.log('--------------------------------------------------');
        console.log('COMPARISON RESULTS');
        console.log('--------------------------------------------------');

        if (standardTask && customTask) {
            console.log("FIELD          | CUSTOM SYNC VALUE                  | STANDARD API VALUE");
            console.log("---------------|------------------------------------|-------------------");

            // Compare Key Fields
            const fields = ['label', 'ref', 'description', 'note_public', 'note_private', 'planned_workload', 'duration_effective'];

            fields.forEach(field => {
                let valCustom = customTask[field];
                let valStandard = standardTask[field];

                // Normalize for display
                if (valCustom === undefined) valCustom = "(undefined)";
                if (valCustom === null) valCustom = "(null)";
                if (valStandard === undefined) valStandard = "(undefined)";
                if (valStandard === null) valStandard = "(null)";

                // Truncate long strings
                const format = (v: any) => String(v).replace(/\n/g, ' ').substring(0, 30).padEnd(35);

                console.log(`${field.padEnd(14)} | ${format(valCustom)}| ${format(valStandard)}`);
            });

            console.log('--------------------------------------------------');

            // Detailed Descriptions
            console.log("\n[FULL DESCRIPTION - CUSTOM SYNC]");
            console.log(customTask.description);
            console.log("\n[FULL DESCRIPTION - STANDARD API]");
            console.log(standardTask.description);

            console.log("\n[NOTES - STANDARD API ONLY]");
            console.log("Public Note:", standardTask.note_public);
            console.log("Private Note:", standardTask.note_private);

        } else {
            console.log("Could not compare - missing data from one or both sources.");
        }

    } catch (error) {
        console.error("Uncaught Error:", error);
    }
}

compareTaskData();
