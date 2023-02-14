import { generateMnemonic, mnemonicToSeed } from 'bip39';
import { networks, Transaction } from 'liquidjs-lib';
import { toOutputScript } from 'liquidjs-lib/src/address';
import { AccountID, AccountType } from 'marina-provider';
import { AccountFactory, MainAccount, MainAccountLegacy, MainAccountTest } from '../src/domain/account';
import { BlinderService } from '../src/domain/blinder';
import { SignerService } from '../src/domain/signer';
import { UpdaterService } from '../src/background/updater';
import { SubscriberService } from '../src/background/subscriber';
import { BlockstreamExplorerURLs, BlockstreamTestnetExplorerURLs, NigiriDefaultExplorerURLs } from '../src/domain/explorer';
import { AppStorageAPI } from '../src/infrastructure/storage/app-repository';
import { AssetStorageAPI } from '../src/infrastructure/storage/asset-repository';
import { WalletStorageAPI } from '../src/infrastructure/storage/wallet-repository';
import { initWalletRepository, makeAccountXPub } from '../src/infrastructure/utils';
import { computeBalances, makeSendPset, SLIP13 } from '../src/utils';
import { faucet, sleep } from './_regtest';
import captchaArtifact from './fixtures/customscript/transfer_with_captcha.ionio.json';
import synthArtifact from './fixtures/customscript/synthetic_asset.ionio.json';
import { Artifact, replaceArtifactConstructorWithArguments, templateString } from '@ionio-lang/ionio';

// we need this to mock the browser.storage.local calls in repositories
jest.mock('webextension-polyfill');

const PASSWORD = 'PASSWORD';

const appRepository = new AppStorageAPI();
const walletRepository = new WalletStorageAPI();
const assetRepository = new AssetStorageAPI(walletRepository);

let factory: AccountFactory;
let mnemonic: string;

describe('Application Layer', () => {
    beforeAll(async () => {
        mnemonic = generateMnemonic();
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


    describe('Account', () => {
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
                const accountName = 'failTestIonioAccountSync';
                const path = SLIP13(accountName);
                const masterXPub = makeAccountXPub(await mnemonicToSeed(mnemonic), path);
                await walletRepository.updateAccountDetails(accountName, {
                    accountID: accountName,
                    accountNetworks: ['regtest'],
                    type: AccountType.Ionio,
                    baseDerivationPath: path,
                    masterXPub,
                });
                const account = await factory.make('regtest', accountName);
                await expect(account.sync()).rejects.toThrowError('Unsupported sync function for account type: ionio');
            });

            test('should restore an account with transactions (and unblind utxos via UpdaterService running in background)', async () => {
                // first let's start the UpdaterService running in background (simulating the background script UpdaterService)
                const zkpLib = await require('@vulpemventures/secp256k1-zkp')();
                const updater = new UpdaterService(walletRepository, appRepository, assetRepository, zkpLib);
                await updater.start();

                // then let's create a new random P2WPKH account
                const randomAccountName = 'randomAccountName' + Math.floor(Math.random() * 1000);
                const baseDerivationPath = SLIP13(randomAccountName);
                const masterXPub = makeAccountXPub(await mnemonicToSeed(mnemonic), baseDerivationPath);
                await walletRepository.updateAccountDetails(randomAccountName, {
                    accountID: randomAccountName,
                    accountNetworks: ['regtest'],
                    type: AccountType.P2WPKH,
                    baseDerivationPath,
                    masterXPub,
                    nextKeyIndexes: {
                        liquid: { external: 0, internal: 0 },
                        testnet: { external: 0, internal: 0 },
                        regtest: { external: 18, internal: 2 }, // let's create some gap (the 18th address is the one we will use)
                    }
                })

                // generate and faucet addresses
                let account = await factory.make('regtest', randomAccountName);
                const address = await account.getNextAddress(false);
                const txID0 = await faucet(address.confidentialAddress, 1);
                const txID1 = await faucet(address.confidentialAddress, 1);
                const addressBis = await account.getNextAddress(false);
                const txID2 = await faucet(addressBis.confidentialAddress, 1);
                const txID3 = await faucet(addressBis.confidentialAddress, 1);
                const changeAddress = await account.getNextAddress(true);
                const txID4 = await faucet(changeAddress.confidentialAddress, 1);
                const txID5 = await faucet(changeAddress.confidentialAddress, 1);
                await sleep(5000); // wait for the txs to be confirmed

                // then let's simulate re-onboarding by erasing the indexes (we "forget" the generated addresses)
                await walletRepository.updateAccountDetails(randomAccountName, {
                    nextKeyIndexes: {
                        liquid: { external: 0, internal: 0 },
                        testnet: { external: 0, internal: 0 },
                        regtest: { external: 0, internal: 0 },
                    }
                });
                let accountDetails = await walletRepository.getAccountDetails(randomAccountName);
                expect(accountDetails[randomAccountName].nextKeyIndexes['regtest'].external).toEqual(0);
                expect(accountDetails[randomAccountName].nextKeyIndexes['regtest'].internal).toEqual(0);
                account = await factory.make('regtest', randomAccountName);
                const res = await account.sync(20);
                await updater.waitForProcessing();
                expect(res.next.external).toEqual(20);
                expect(res.next.internal).toEqual(3);

                accountDetails = await walletRepository.getAccountDetails(randomAccountName);
                expect(accountDetails[randomAccountName]).toBeDefined();
                expect(accountDetails[randomAccountName].nextKeyIndexes['regtest'].external).toEqual(20);
                expect(accountDetails[randomAccountName].nextKeyIndexes['regtest'].internal).toEqual(3);

                // check is the txs are here
                const txs = await walletRepository.getTransactions('regtest');
                expect(txs).toContain(txID0);
                expect(txs).toContain(txID1);
                expect(txs).toContain(txID2);
                expect(txs).toContain(txID3);
                expect(txs).toContain(txID4);
                expect(txs).toContain(txID5);
                // check the utxos
                const utxos = await walletRepository.getUtxos('regtest', randomAccountName);
                expect(utxos).toHaveLength(6);
                const balances = computeBalances(utxos);
                expect(balances).toEqual({
                    [networks.regtest.assetHash]: 6_00_000_000,
                });
                await updater.stop();
            }, 20_000);
        })
    });

    describe('BlinderService & SignerService', () => {
        let accountName: AccountID;
        let ionioAccountName: AccountID;

        beforeAll(async () => {
            const zkpLib = await require('@vulpemventures/secp256k1-zkp')();
            const updater = new UpdaterService(walletRepository, appRepository, assetRepository, zkpLib);
            const seed = await mnemonicToSeed(mnemonic);
            await updater.start();
            accountName = 'signerServiceTestAccount' + Math.floor(Math.random() * 1000);
            const baseDerivationPath = SLIP13(accountName);
            const masterXPub = makeAccountXPub(seed, baseDerivationPath);
            await walletRepository.updateAccountDetails(accountName, {
                accountID: accountName,
                accountNetworks: ['regtest'],
                type: AccountType.P2WPKH,
                baseDerivationPath,
                masterXPub,
                nextKeyIndexes: {
                    liquid: { external: 0, internal: 0 },
                    testnet: { external: 0, internal: 0 },
                    regtest: { external: 0, internal: 0 },
                }
            });

            ionioAccountName = 'signerServiceTestIonioAccount' + Math.floor(Math.random() * 1000);
            const baseIonioPath = SLIP13(ionioAccountName);
            const masterXPubIonio = makeAccountXPub(seed, baseIonioPath);
            await walletRepository.updateAccountDetails(ionioAccountName, {
                accountID: ionioAccountName,
                accountNetworks: ['regtest'],
                type: AccountType.Ionio,
                masterXPub: masterXPubIonio,
                nextKeyIndexes: {
                    liquid: { external: 0, internal: 0 },
                    testnet: { external: 0, internal: 0 },
                    regtest: { external: 0, internal: 0 }
                }
            })
            // faucet it
            const account = await factory.make('regtest', accountName);
            const address = await account.getNextAddress(false);
            await faucet(address.confidentialAddress, 1);
            await faucet(address.confidentialAddress, 1);
            await sleep(5000); // wait for the txs to be confirmed
            await account.sync(20, { internal: 0, external: 0 });

            // create the Ionio artifact address
            const ionioAccount = await factory.make('regtest', ionioAccountName);
            const captchaAddress = ionioAccount.getNextAddress(false, { 
                artifact: replaceArtifactConstructorWithArguments(captchaArtifact as Artifact, [templateString('sum'), templateString(ionioAccountName)]), 
                args: { sum: 10 }
            })

            await updater.waitForProcessing();
            await updater.stop();
        }, 10_000);

        it('should sign all the accounts inputs (and blind outputs)', async () => {
            const zkpLib = await require('@vulpemventures/secp256k1-zkp')();
            const blinder = new BlinderService(walletRepository, zkpLib);
            const signer = await SignerService.fromPassword(walletRepository, appRepository, PASSWORD);
            const { pset } = await makeSendPset(
                [{
                    address: 'el1qqge8cmyqh0ttlmukx3vrfx6escuwn9fp6vukug85m67qx4grus5llwvmctt7nr9vyzafy4ntn7l6y74cvvgywsmnnzg25x77e',
                    asset: networks.regtest.assetHash,
                    value: 200_000_000 - 10_0000,
                }],
                [],
                networks.regtest.assetHash,
                [accountName]
            );

            const blindedPset = await blinder.blindPset(pset);
            const signedPset = await signer.signPset(blindedPset);
            const hex = signer.finalizeAndExtract(signedPset);
            expect(hex).toBeTruthy();
            const transaction = Transaction.fromHex(hex);
            expect(transaction.ins).toHaveLength(2);
            const chainSource = factory.chainSources.get('regtest');
            const txID = await chainSource?.broadcastTransaction(hex);
            expect(txID).toEqual(transaction.getId());
        }, 10_000);

        describe('Ionio contract', () => {
            it('transfer_with_captcha.ionio contract', async () => {

            })
        })
    })

    afterAll(async () => {
        for (const source of factory.chainSources.values()) {
            await source.close();
        }
    });
})