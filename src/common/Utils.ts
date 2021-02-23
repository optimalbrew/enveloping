import abi from 'web3-eth-abi'
import ethUtils from 'ethereumjs-util'
import web3Utils from 'web3-utils'
import sigUtil from 'eth-sig-util'
import { EventData } from 'web3-eth-contract'
import { JsonRpcResponse } from 'web3-core-helpers'
import { PrefixedHexString, Transaction } from 'ethereumjs-tx'

import { Address, IntString } from '../relayclient/types/Aliases'
import { ServerConfigParams } from '../relayserver/ServerConfigParams'

import TypedRequestData, { getDomainSeparatorHash } from './EIP712/TypedRequestData'
import { getDependencies, GSNConfig, GSNDependencies } from '../relayclient/GSNConfigurator'
import chalk from 'chalk'

import HttpClient from '../relayclient/HttpClient'
import { DeployRequest, RelayRequest } from './EIP712/RelayRequest'

import ContractInteractor, { Web3Provider } from '../relayclient/ContractInteractor'
import { DeployTransactionRequest, RelayMetadata, RelayTransactionRequest } from '../relayclient/types/RelayTransactionRequest'
import HttpWrapper from '../relayclient/HttpWrapper'
import { IKnownRelaysManager } from '../relayclient/KnownRelaysManager'
import RelaySelectionManager from '../relayclient/RelaySelectionManager'
import GsnTransactionDetails from '../relayclient/types/GsnTransactionDetails'
import { constants } from './Constants'
import { RelayingAttempt, RelayingResult } from '../relayclient/RelayClient'
import { RelayInfo } from '../relayclient/types/RelayInfo'
import { HttpProvider } from 'web3-core'

export function removeHexPrefix (hex: string): string {
  if (hex == null || typeof hex.replace !== 'function') {
    throw new Error('Cannot remove hex prefix')
  }
  return hex.replace(/^0x/, '')
}

const zeroPad = '0000000000000000000000000000000000000000000000000000000000000000'

export function padTo64 (hex: string): string {
  if (hex.length < 64) {
    hex = (zeroPad + hex).slice(-64)
  }
  return hex
}

export function event2topic (contract: any, names: string[]): any {
  // for testing: don't crash on mockup..
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (!contract.options || !contract.options.jsonInterface) { return names }
  if (typeof names === 'string') {
    return event2topic(contract, [names])[0]
  }
  return contract.options.jsonInterface
    .filter((e: any) => names.includes(e.name))
    // @ts-ignore
    .map(abi.encodeEventSignature)
}

export function addresses2topics (addresses: string[]): string[] {
  return addresses.map(address2topic)
}

export function address2topic (address: string): string {
  return '0x' + '0'.repeat(24) + address.toLowerCase().slice(2)
}

// extract revert reason from a revert bytes array.
export function decodeRevertReason (revertBytes: PrefixedHexString, throwOnError = false): string | null {
  if (revertBytes == null) { return null }
  if (!revertBytes.startsWith('0x08c379a0')) {
    if (throwOnError) {
      throw new Error('invalid revert bytes: ' + revertBytes)
    }
    return revertBytes
  }
  // @ts-ignore
  return abi.decodeParameter('string', '0x' + revertBytes.slice(10)) as any
}

export function getLocalEip712Signature (
  typedRequestData: TypedRequestData,
  privateKey: Buffer,
  jsonStringifyRequest = false
): PrefixedHexString {
  let dataToSign: TypedRequestData | string
  if (jsonStringifyRequest) {
    dataToSign = JSON.stringify(typedRequestData)
  } else {
    dataToSign = typedRequestData
  }

  // @ts-ignore
  return sigUtil.signTypedData_v4(privateKey, { data: dataToSign })
}

export async function getEip712Signature (
  web3: Web3,
  typedRequestData: TypedRequestData,
  methodSuffix = '',
  jsonStringifyRequest = false
): Promise<PrefixedHexString> {
  const senderAddress = typedRequestData.message.from
  let dataToSign: TypedRequestData | string
  if (jsonStringifyRequest) {
    dataToSign = JSON.stringify(typedRequestData)
  } else {
    dataToSign = typedRequestData
  }
  return await new Promise((resolve, reject) => {
    let method
    // @ts-ignore (the entire web3 typing is fucked up)
    if (typeof web3.currentProvider.sendAsync === 'function') {
      // @ts-ignore
      method = web3.currentProvider.sendAsync
    } else {
      // @ts-ignore
      method = web3.currentProvider.send
    }
    method.bind(web3.currentProvider)({
      method: 'eth_signTypedData' + methodSuffix,
      params: [senderAddress, dataToSign],
      from: senderAddress,
      id: Date.now()
    }, (error: Error | string | null, result?: JsonRpcResponse) => {
      if (result?.error != null) {
        error = result.error
      }
      if (error != null || result == null) {
        reject((error as any).message ?? error)
      } else {
        resolve(result.result)
      }
    })
  })
}

/**
 * @returns maximum possible gas consumption by this relayed call
 */
export function calculateTransactionMaxPossibleGas (

  hubOverhead: number,
  relayCallGasLimit: string,
  cushion: number
): number {
  return hubOverhead +
    parseInt(relayCallGasLimit) + cushion
}

export function getEcRecoverMeta (message: PrefixedHexString, signature: string | Signature): PrefixedHexString {
  if (typeof signature === 'string') {
    const r = parseHexString(signature.substr(2, 65))
    const s = parseHexString(signature.substr(66, 65))
    const v = parseHexString(signature.substr(130, 2))

    signature = {
      v: v,
      r: r,
      s: s
    }
  }
  const msg = Buffer.concat([Buffer.from('\x19Ethereum Signed Message:\n32'), Buffer.from(removeHexPrefix(message), 'hex')])
  const signed = web3Utils.sha3('0x' + msg.toString('hex'))
  if (signed == null) {
    throw new Error('web3Utils.sha3 failed somehow')
  }
  const bufSigned = Buffer.from(removeHexPrefix(signed), 'hex')
  const recoveredPubKey = ethUtils.ecrecover(bufSigned, signature.v[0], Buffer.from(signature.r), Buffer.from(signature.s))
  return ethUtils.bufferToHex(ethUtils.pubToAddress(recoveredPubKey))
}

export function parseHexString (str: string): number[] {
  const result = []
  while (str.length >= 2) {
    result.push(parseInt(str.substring(0, 2), 16))

    str = str.substring(2, str.length)
  }

  return result
}

export function isSameAddress (address1: Address, address2: Address): boolean {
  return address1.toLowerCase() === address2.toLowerCase()
}

export async function sleep (ms: number): Promise<void> {
  return await new Promise(resolve => setTimeout(resolve, ms))
}

export function randomInRange (min: number, max: number): number {
  return Math.floor(Math.random() * (max - min) + min)
}

export function isSecondEventLater (a: EventData, b: EventData): boolean {
  if (a.blockNumber === b.blockNumber) {
    return b.transactionIndex > a.transactionIndex
  }
  return b.blockNumber > a.blockNumber
}

export function getLatestEventData (events: EventData[]): EventData | undefined {
  if (events.length === 0) {
    return
  }
  const eventDataSorted = events.sort(
    (a: EventData, b: EventData) => {
      if (a.blockNumber === b.blockNumber) {
        return b.transactionIndex - a.transactionIndex
      }
      return b.blockNumber - a.blockNumber
    })
  return eventDataSorted[0]
}

export function isRegistrationValid (registerEvent: EventData | undefined, config: ServerConfigParams, managerAddress: Address): boolean {
  const portIncluded: boolean = config.url.indexOf(':') > 0
  return registerEvent != null &&
    isSameAddress(registerEvent.returnValues.relayManager, managerAddress) &&
    registerEvent.returnValues.baseRelayFee.toString() === config.baseRelayFee.toString() &&
    registerEvent.returnValues.pctRelayFee.toString() === config.pctRelayFee.toString() &&
    registerEvent.returnValues.relayUrl.toString() === (config.url.toString() + ((!portIncluded && config.port > 0) ? ':' + config.port.toString() : ''))
}

/**
 * @param gasLimits
 * @param hubOverhead
 * @param relayCallGasLimit
 * @param calldataSize
 * @param gtxdatanonzero
 */
interface TransactionGasComponents {
  gasLimits: VerifierGasLimits
  hubOverhead: number
  relayCallGasLimit: string
}

export interface VerifierGasLimits {
  acceptanceBudget: string
  preRelayedCallGasLimit: string
  postRelayedCallGasLimit: string
}

interface Signature {
  v: number[]
  r: number[]
  s: number[]
}

export function boolString (bool: boolean): string {
  return bool ? chalk.green('good'.padEnd(14)) : chalk.red('wrong'.padEnd(14))
}

export class EnvelopingUtils {
  
  config: GSNConfig
  relayWorkerAddress : Address
  dependencies: GSNDependencies
  private initialized: boolean

  constructor(_config: GSNConfig, _web3 : Web3, _relayWorkerAddress : Address) {
    this.config = _config
    this.initialized = false
    this.dependencies = getDependencies(this.config, _web3.currentProvider as HttpProvider)
    this.relayWorkerAddress = _relayWorkerAddress
  }

  async _init() : Promise<void> {
    if(!this.initialized) {
      await this.dependencies.contractInteractor.init()
      this.initialized = true
    } else {
      throw new Error('_init was already called')
    }
  }

  async createDeployRequest(from: Address, gasLimit: IntString, tokenContract:  Address, tokenAmount: IntString, tokenGas: IntString, gasPrice?: IntString, index? : IntString, recoverer? : IntString): Promise<DeployRequest> {
    const deployRequest : DeployRequest = {
      request: {
      relayHub: this.config.relayHubAddress,
      from: from,
      to: this.config.proxyFactoryAddress,
      value: '0',
      gas: gasLimit, //overhead (cte) + fee + (estimateDeploy * 1.1)
      nonce: this.getFactoryNonce(this.config.proxyFactoryAddress, from).toString(),
      data: '0x',
      tokenContract: tokenContract,
      tokenAmount: tokenAmount,
      tokenGas: tokenGas,
      recoverer: recoverer ?? constants.ZERO_ADDRESS,
      index: index ?? '0'
    }, 
    relayData: {
      gasPrice: gasPrice ?? '0',
      relayWorker: this.relayWorkerAddress,
      callForwarder: this.config.forwarderAddress,
      callVerifier: this.config.deployVerifierAddress,
      domainSeparator: getDomainSeparatorHash(this.config.forwarderAddress, this.config.chainId)
    }
  }

    return deployRequest
  }
  
  async createRelayRequest(from: Address, to: Address, data: PrefixedHexString, gasLimit: IntString, tokenContract:  Address, tokenAmount: IntString, tokenGas: IntString, gasPrice?: IntString): Promise<RelayRequest> {
    const relayRequest : RelayRequest = {
      request: {
      relayHub: this.config.relayHubAddress,
      from: from,
      to: to,
      data: data,
      value: '0',
      gas: gasLimit,
      nonce: this.getSenderNonce(this.config.forwarderAddress).toString(),
      tokenContract: tokenContract,
      tokenAmount: tokenAmount,
      tokenGas: tokenGas
    }, 
    relayData: {
      gasPrice: gasPrice ?? '0',
      relayWorker: this.relayWorkerAddress,
      callForwarder: this.config.forwarderAddress,
      callVerifier: this.config.relayVerifierAddress,
      domainSeparator: getDomainSeparatorHash(this.config.forwarderAddress, this.config.chainId)
    }
  }
  
    return relayRequest
  }

  signRequest(privKey : Buffer, request : RelayRequest|DeployRequest) : PrefixedHexString {
    const cloneRequest = { ...request }
    const dataToSign = new TypedRequestData(
        this.config.chainId,
        this.config.forwarderAddress,
        cloneRequest
    )
    
    // @ts-ignore
    return sigUtil.signTypedData_v4(privKey, { data: dataToSign })
  }

  async generateMetadata(signature : PrefixedHexString) : Promise<RelayMetadata> {
    const metadata: RelayMetadata = {
      relayHubAddress: this.config.relayHubAddress,
      signature: signature,
      approvalData: '0x',
      relayMaxNonce: await this.dependencies.contractInteractor.getTransactionCount(this.relayWorkerAddress) + this.config.maxRelayNonceGap
    }

    return metadata
  }

  async sendHttpRelayRequest(relayRequest : RelayRequest, signature : PrefixedHexString) : Promise<RelayingResult> {
    const metadata: RelayMetadata = await this.generateMetadata(signature)
    const relayTransactionRequest : RelayTransactionRequest = {
      relayRequest,
      metadata
    }
    const knownRelaysManager = this.dependencies.knownRelaysManager
    await knownRelaysManager.refresh()
    const gsnTransactionDetails = this.createTransactionDetails(relayRequest.request.from, relayRequest.request.data, relayRequest.request.from, relayRequest.request.value, relayRequest.request.tokenContract, 
      relayRequest.request.tokenAmount, relayRequest.request.tokenGas)
    const relaySelectionManager = await new RelaySelectionManager(gsnTransactionDetails, knownRelaysManager, this.dependencies.httpClient, this.dependencies.pingFilter, this.config).init()
    const relayingErrors = new Map<string, Error>()
    while(true) {
      let relayingAttempt: RelayingAttempt | undefined
      const activeRelay = await relaySelectionManager.selectNextRelay()
      if (activeRelay !== undefined && activeRelay !== null) {
        relayingAttempt = await this._attemptRelay(knownRelaysManager, activeRelay, gsnTransactionDetails, relayTransactionRequest).catch(error => ({ error }))
        if (relayingAttempt.transaction === undefined || relayingAttempt.transaction === null) {
          relayingErrors.set(activeRelay.relayInfo.relayUrl, relayingAttempt.error ?? new Error('No error reason was given'))
          continue
        }
        return {
          transaction: relayingAttempt?.transaction,
          relayingErrors,
          pingErrors: relaySelectionManager.errors
        }
      }
    }
  }

  async sendHttpDeployRequest(deployRequest : DeployRequest, signature : PrefixedHexString) : Promise<RelayingResult> {
    const metadata: RelayMetadata = await this.generateMetadata(signature)
    const deployTransactionRequest : DeployTransactionRequest = {
      relayRequest: deployRequest,
      metadata
    }
    const knownRelaysManager = this.dependencies.knownRelaysManager
    await knownRelaysManager.refresh()
    const gsnTransactionDetails = this.createTransactionDetails(deployRequest.request.from, deployRequest.request.data, deployRequest.request.from, deployRequest.request.value, deployRequest.request.tokenContract, 
      deployRequest.request.tokenAmount, deployRequest.request.tokenGas)
    const relaySelectionManager = await new RelaySelectionManager(gsnTransactionDetails, knownRelaysManager, this.dependencies.httpClient, this.dependencies.pingFilter, this.config).init()
    const relayingErrors = new Map<string, Error>()
    while (true) {
      let relayingAttempt: RelayingAttempt | undefined
      const activeRelay = await relaySelectionManager.selectNextRelay()
      if (activeRelay !== undefined && activeRelay !== null) {
        relayingAttempt = await this._attemptDeploy(knownRelaysManager, activeRelay, gsnTransactionDetails, deployTransactionRequest).catch(error => ({ error }))
        if (relayingAttempt.transaction === undefined || relayingAttempt.transaction === null) {
          relayingErrors.set(activeRelay.relayInfo.relayUrl, relayingAttempt.error ?? new Error('No error reason was given'))
          continue
        }
        return {
          transaction: relayingAttempt?.transaction,
          relayingErrors,
          pingErrors: relaySelectionManager.errors
        }
      }
    }
  }

  async _attemptRelay(knownRelaysManager: IKnownRelaysManager, relayInfo: RelayInfo, gsnTransactionDetails: GsnTransactionDetails, request: RelayTransactionRequest): Promise<RelayingAttempt> {
    // log.info(`attempting relay: ${JSON.stringify(relayInfo)} transaction: ${JSON.stringify(gsnTransactionDetails)}`)
    const maxAcceptanceBudget = parseInt(relayInfo.pingResponse.maxAcceptanceBudget)
    let acceptRelayCallResult = await this.dependencies.contractInteractor.validateAcceptRelayCall(request.relayRequest, request.metadata.signature, request.metadata.approvalData)
    
    if (!acceptRelayCallResult.verifierAccepted) {
      let message: string
      if (acceptRelayCallResult.reverted) {
        message = 'local view call to \'relayCall()\' reverted'
      } else {
        message = 'verifier rejected in local view call to \'relayCall()\' '
      }
      return { error: new Error(`${message}: ${decodeRevertReason(acceptRelayCallResult.returnValue)}`) }
    }
    let hexTransaction: PrefixedHexString
    try {
      hexTransaction = await this.dependencies.httpClient.relayTransaction(relayInfo.relayInfo.relayUrl, request)
    } catch (error) {
      if (error?.message == null || error.message.indexOf('timeout') !== -1) {
        knownRelaysManager.saveRelayFailure(new Date().getTime(), relayInfo.relayInfo.relayManager, relayInfo.relayInfo.relayUrl)
      }
      return { error }
    }
    const transaction = new Transaction(hexTransaction, this.dependencies.contractInteractor.getRawTxOptions())
    if (!this.dependencies.transactionValidator.validateRelayResponse(request, maxAcceptanceBudget, hexTransaction)) {
      knownRelaysManager.saveRelayFailure(new Date().getTime(), relayInfo.relayInfo.relayManager, relayInfo.relayInfo.relayUrl)
      return { error: new Error('Returned transaction did not pass validation') }
    }
    return {
      transaction
    }
  } 

  async _attemptDeploy(knownRelaysManager: IKnownRelaysManager, relayInfo: RelayInfo, gsnTransactionDetails: GsnTransactionDetails, request: DeployTransactionRequest): Promise<RelayingAttempt> {
    // log.info(`attempting relay: ${JSON.stringify(relayInfo)} transaction: ${JSON.stringify(gsnTransactionDetails)}`)
    const maxAcceptanceBudget = parseInt(relayInfo.pingResponse.maxAcceptanceBudget)
    let acceptDeployCallResult = await this.dependencies.contractInteractor.validateAcceptDeployCall(request.relayRequest, request.metadata.signature, request.metadata.approvalData)
    
    if (!acceptDeployCallResult.verifierAccepted) {
      let message: string
      if (acceptDeployCallResult.reverted) {
        message = 'local view call to \'relayCall()\' reverted'
      } else {
        message = 'verifier rejected in local view call to \'relayCall()\' '
      }
      return { error: new Error(`${message}: ${decodeRevertReason(acceptDeployCallResult.returnValue)}`) }
    }
    let hexTransaction: PrefixedHexString
    try {
      hexTransaction = await this.dependencies.httpClient.relayTransaction(relayInfo.relayInfo.relayUrl, request)
    } catch (error) {
      if (error?.message == null || error.message.indexOf('timeout') !== -1) {
        knownRelaysManager.saveRelayFailure(new Date().getTime(), relayInfo.relayInfo.relayManager, relayInfo.relayInfo.relayUrl)
      }
      return { error }
    }
    const transaction = new Transaction(hexTransaction, this.dependencies.contractInteractor.getRawTxOptions())
    if (!this.dependencies.transactionValidator.validateRelayResponse(request, maxAcceptanceBudget, hexTransaction)) {
      knownRelaysManager.saveRelayFailure(new Date().getTime(), relayInfo.relayInfo.relayManager, relayInfo.relayInfo.relayUrl)
      return { error: new Error('Returned transaction did not pass validation') }
    }
    return {
      transaction
    }
  } 

  async getSenderNonce (sWallet: Address): Promise<IntString> {
    return await this.dependencies.contractInteractor.getSenderNonce(sWallet)
  }
​
  async getFactoryNonce (factoryAddr: Address, from: Address): Promise<IntString> {
    return await this.dependencies.contractInteractor.getFactoryNonce(factoryAddr, from)
  }

  createTransactionDetails(from: Address, data: PrefixedHexString, to: Address, value: IntString, tokenContract?: Address, tokenAmount?: IntString, tokenGas?: IntString, recoverer?: Address, index?: IntString) : GsnTransactionDetails {
    const gsnTransactionDetails : GsnTransactionDetails = {
      from,
      data,
      to,
      tokenContract: tokenContract?? constants.ZERO_ADDRESS,
      tokenAmount: tokenAmount ?? '0x00',
      tokenGas: tokenGas ?? '0x00',
      value,
      recoverer: recoverer?? '0',
      index: index?? '0',
      isSmartWalletDeploy: true,
    }
    return gsnTransactionDetails
  }
}
