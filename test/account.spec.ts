import { generateMnemonic } from 'bip39';
import { toOutputScript } from 'liquidjs-lib/src/address';
import { AccountFactory, MainAccount, MainAccountLegacy, MainAccountTest } from '../src/domain/account';
import { BlockstreamExplorerURLs, BlockstreamTestnetExplorerURLs, NigiriDefaultExplorerURLs } from '../src/domain/explorer';
import { AppStorageAPI } from '../src/infrastructure/storage/app-repository';
import { WalletStorageAPI } from '../src/infrastructure/storage/wallet-repository';
import { initWalletRepository } from '../src/infrastructure/utils';

// we need this to mock the browser.storage.local calls in repositories
jest.mock('webextension-polyfill');

const PASSWORD = 'PASSWORD';

const appRepository = new AppStorageAPI();
const walletRepository = new WalletStorageAPI();

let factory: AccountFactory;

describe('Account', () => {
    beforeAll(async () => {
        const mnemonic = generateMnemonic();
        // set up a random wallet in repository
        // also set up default main Marina accounts
        await initWalletRepository(walletRepository, mnemonic, PASSWORD);
        await appRepository.setNetwork('regtest'); // switch to regtest
        await appRepository.setWebsocketExplorerURLs({
            liquid: BlockstreamExplorerURLs.websocketExplorerURL,
            regtest: NigiriDefaultExplorerURLs.websocketExplorerURL,
            testnet: BlockstreamTestnetExplorerURLs.websocketExplorerURL,
        })

        factory = await AccountFactory.create(walletRepository, appRepository, ['liquid', 'regtest', 'testnet']);
    });

    describe('AccountFactory', () => {
        for (const ID of [MainAccount, MainAccountLegacy, MainAccountTest]) {
            test(`should create ${ID} account`, async () => {
                const account = await factory.make(ID === MainAccountTest ? 'regtest' : 'liquid', ID);
                expect(account).toBeDefined();
                expect(account.name).toEqual(ID);
            });
        }
    })

    describe('getNextAddress', () => { 
        test('should update account details once external address is generated', async () => {
            const account = await factory.make('regtest', MainAccountTest);
            const index = (await walletRepository.getAccountDetails(MainAccountTest))[MainAccountTest].nextKeyIndexes['regtest'].external;
            const address = await account.getNextAddress(false);
            expect(address).toBeDefined();
            const scriptFromAddress = toOutputScript(address.confidentialAddress).toString('hex');
            const scripts = Object.keys(await walletRepository.getAccountScripts('regtest', MainAccountTest));
            const { [scriptFromAddress]: details } = await walletRepository.getScriptDetails(scriptFromAddress)
            expect(details).toBeDefined();
            expect(details.accountName).toEqual(MainAccountTest);
            expect(details.derivationPath).toEqual(address.derivationPath);
            expect(scripts).toContain(scriptFromAddress);
            const accountDetails = await walletRepository.getAccountDetails(MainAccountTest);
            expect(accountDetails[MainAccountTest]).toBeDefined();
            expect(accountDetails[MainAccountTest].nextKeyIndexes['regtest'].external).toEqual(index + 1);
        });

        test('should update account details once internal address is generated', async () => {
            const account = await factory.make('regtest', MainAccountTest);
            const index = (await walletRepository.getAccountDetails(MainAccountTest))[MainAccountTest].nextKeyIndexes['regtest'].internal;
            const address = await account.getNextAddress(true);
            expect(address).toBeDefined();
            const scriptFromAddress = toOutputScript(address.confidentialAddress).toString('hex');
            const scripts = Object.keys(await walletRepository.getAccountScripts('regtest', MainAccountTest));
            const { [scriptFromAddress]: details } = await walletRepository.getScriptDetails(scriptFromAddress)
            expect(details).toBeDefined();
            expect(details.accountName).toEqual(MainAccountTest);
            expect(details.derivationPath).toEqual(address.derivationPath);
            expect(scripts).toContain(scriptFromAddress);
            const accountDetails = await walletRepository.getAccountDetails(MainAccountTest);
            expect(accountDetails[MainAccountTest]).toBeDefined();
            expect(accountDetails[MainAccountTest].nextKeyIndexes['regtest'].internal).toEqual(index + 1);
        });
    });

    describe('sync', () => {
        test('should fail if the account type is AccountType.Ionio', async () => {
        });

        test('should restore an account with transactions', async () => {

        });
    })

    afterAll(async () => {
        for (const source of factory.chainSources.values()) {
            await source.close();
        }
    });
});
