
import { dolibarrService } from '../services/dolibarrService';
import { config } from '../config/env';

async function check() {
    console.log("Checking connection using env config...");
    console.log("URL:", config.dolibarrUrl);
    console.log("Key:", config.dolibarrKey ? "Found (starts with " + config.dolibarrKey.substring(0, 3) + ")" : "MISSING");

    try {
        console.log("1. Testing validateApiKey...");
        const isValid = await dolibarrService.validateApiKey(config.dolibarrKey);
        console.log("API Key Valid?", isValid);

        if (isValid) {
            console.log("2. Testing Write (Create ThirdParty - DUMMY)...");
            // We'll try to create a dummy thirdparty to test if strict write methods work
            // If they fail with 401, it confirms the header stripping issue.
            try {
                const timestamp = Date.now();
                const dummyData = {
                    name: `Test-${timestamp}`,
                    email: `test-${timestamp}@example.com`,
                    client: '0',
                    fournisseur: '0'
                };

                // We need to cast dummyData to any or the specific type if we had it imported
                const result = await dolibarrService.createThirdParty(dummyData as any, config.dolibarrKey);
                console.log("Write SUCCESS:", result);
            } catch (writeError: any) {
                console.error("Write FAILED:");
                console.error(writeError.message);
                if (writeError.response) {
                    console.error("Status:", writeError.response.status);
                    console.error("Data:", writeError.response.data);
                }
            }
        }

    } catch (error: any) {
        console.error("Validation FAILED");
        console.error(error.message);
    }
}

check();
