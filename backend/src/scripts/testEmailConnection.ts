
import { emailService } from '../services/emailService';
import { emailStoreService } from '../services/emailStoreService';

async function test() {
    console.log('Starting email test...');
    const accounts = emailStoreService.getAllAccounts();
    console.log(`Found ${accounts.length} accounts.`);

    for (const account of accounts) {
        console.log(`Testing account: ${account.name} (${account.email})`);
        try {
            console.log('Fetching folders...');
            const folders = await emailService.getFolders(account.id);
            console.log('Folders found:', Object.keys(folders));

            console.log('Fetching messages from INBOX...');
            const messages = await emailService.getMessages(account.id, 'INBOX', 5);
            console.log(`Successfully fetched ${messages.length} messages.`);
            if (messages.length > 0) {
                console.log('First message subject:', messages[0].subject);
                console.log('First message date:', messages[0].date);
            }
        } catch (error: any) {
            console.error(`Error testing account ${account.name}:`, error.message);
            if (error.source) console.error('Error source:', error.source);
        }
    }
    process.exit(0);
}

test();
