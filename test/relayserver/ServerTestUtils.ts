// @ts-ignore
import abiDecoder from 'abi-decoder'
import { TransactionReceipt } from 'web3-core'
import { toBN } from 'web3-utils'

import VerifierABI from '../../src/common/interfaces/IVerifier.json'
import DeployVerifierABI from '../../src/common/interfaces/IDeployVerifier.json'

import RelayHubABI from '../../src/common/interfaces/IRelayHub.json'
import StakeManagerABI from '../../src/common/interfaces/IStakeManager.json'
import { RelayServer } from '../../src/relayserver/RelayServer'
import { PrefixedHexString } from 'ethereumjs-tx'

const TestRecipient = artifacts.require('TestRecipient')
const TestVerifierEverythingAccepted = artifacts.require('TestVerifierEverythingAccepted')
const TestDeployVerifierEverythingAccepted = artifacts.require('TestDeployVerifierEverythingAccepted')

abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(StakeManagerABI)
abiDecoder.addABI(VerifierABI)
abiDecoder.addABI(DeployVerifierABI)

// @ts-ignore
abiDecoder.addABI(TestRecipient.abi)
// @ts-ignore
abiDecoder.addABI(TestVerifierEverythingAccepted.abi)
// @ts-ignore
abiDecoder.addABI(TestDeployVerifierEverythingAccepted.abi)

async function resolveAllReceipts (transactionHashes: PrefixedHexString[]): Promise<TransactionReceipt[]> {
  // actually returns promise for '.all'
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  return await Promise.all(transactionHashes.map((transactionHash) => web3.eth.getTransactionReceipt(transactionHash)))
}

export async function assertRelayAdded (transactionHashes: PrefixedHexString[], server: RelayServer, checkWorkers = true): Promise<void> {
  const receipts = await resolveAllReceipts(transactionHashes)
  const registeredReceipt = receipts.find(r => {
    const decodedLogs = abiDecoder.decodeLogs(r.logs).map(server.registrationManager._parseEvent)
    return decodedLogs[0].name === 'RelayServerRegistered'
  })
  if (registeredReceipt == null) {
    throw new Error('Registered Receipt not found')
  }
  const registeredLogs = abiDecoder.decodeLogs(registeredReceipt.logs).map(server.registrationManager._parseEvent)
  assert.equal(registeredLogs.length, 1)
  assert.equal(registeredLogs[0].name, 'RelayServerRegistered')
  assert.equal(registeredLogs[0].args.relayManager.toLowerCase(), server.managerAddress.toLowerCase())
  assert.equal(registeredLogs[0].args.baseRelayFee, server.config.baseRelayFee)
  assert.equal(registeredLogs[0].args.pctRelayFee, server.config.pctRelayFee)
  assert.equal(registeredLogs[0].args.relayUrl, server.config.url)

  if (checkWorkers) {
    const workersAddedReceipt = receipts.find(r => {
      const decodedLogs = abiDecoder.decodeLogs(r.logs).map(server.registrationManager._parseEvent)
      return decodedLogs[0].name === 'RelayWorkersAdded'
    })
    const workersAddedLogs = abiDecoder.decodeLogs(workersAddedReceipt!.logs).map(server.registrationManager._parseEvent)
    assert.equal(workersAddedLogs.length, 1)
    assert.equal(workersAddedLogs[0].name, 'RelayWorkersAdded')
  }
}

export async function getTotalTxCosts (transactionHashes: PrefixedHexString[], gasPrice: string): Promise<BN> {
  const receipts = await resolveAllReceipts(transactionHashes)
  return receipts.map(r => toBN(r.gasUsed).mul(toBN(gasPrice))).reduce(
    (previous, current) => previous.add(current), toBN(0))
}

export interface ServerWorkdirs {
  workdir: string
  managerWorkdir: string
  workersWorkdir: string
}

export function getTemporaryWorkdirs (): ServerWorkdirs {
  const workdir = '/tmp/enveloping/test/relayserver/defunct' + Date.now().toString()
  const managerWorkdir = workdir + '/manager'
  const workersWorkdir = workdir + '/workers'

  return {
    workdir,
    managerWorkdir,
    workersWorkdir
  }
}
