import { useEffect } from 'react'
import useAsync, { type AsyncResult } from '../useAsync'
import useSafeInfo from '../useSafeInfo'
import { Errors, logError } from '@/services/exceptions'
import type { SpendingLimitState } from '@/store/spendingLimitsSlice'
import useChainId from '@/hooks/useChainId'
import { getWeb3, useWeb3ReadOnly } from '@/hooks/wallets/web3'
import type { JsonRpcProvider } from '@ethersproject/providers'
import { getSpendingLimitContract, getSpendingLimitModuleAddress } from '@/services/contracts/spendingLimitContracts'
import type { AddressEx, TokenInfo } from '@safe-global/safe-gateway-typescript-sdk'
import { sameAddress } from '@/utils/addresses'
import { ERC20__factory } from '@/types/contracts'
import type { AllowanceModule } from '@/types/contracts'

import { sameString } from '@crossbell-box/safe-core-sdk/dist/src/utils'
import { useAppSelector } from '@/store'
import { selectTokens } from '@/store/balancesSlice'
import { isEqual } from 'lodash'

const DEFAULT_TOKEN_INFO = {
  decimals: 18,
  symbol: '',
}

const isModuleEnabled = (modules: string[], moduleAddress: string): boolean => {
  return modules?.some((module) => sameAddress(module, moduleAddress)) ?? false
}

const discardZeroAllowance = (spendingLimit: SpendingLimitState): boolean =>
  !(sameString(spendingLimit.amount, '0') && sameString(spendingLimit.resetTimeMin, '0'))

const getTokenInfoFromBalances = (tokenInfoFromBalances: TokenInfo[], address: string): TokenInfo | undefined =>
  tokenInfoFromBalances.find((token) => token.address === address)

const getTokenInfoOnChain = async (
  address: string,
): Promise<Omit<TokenInfo, 'name' | 'type' | 'logoUri'> | undefined> => {
  const web3 = getWeb3()
  if (!web3) return

  const erc20 = ERC20__factory.connect(address, web3)
  const [symbol, decimals] = await Promise.all([erc20.symbol(), erc20.decimals()])
  return {
    address,
    symbol,
    decimals,
  }
}

export const getTokenAllowanceForDelegate = async (
  contract: AllowanceModule,
  safeAddress: string,
  delegate: string,
  token: string,
  tokenInfoFromBalances: TokenInfo[],
): Promise<SpendingLimitState> => {
  const tokenAllowance = await contract.getTokenAllowance(safeAddress, delegate, token)
  const [amount, spent, resetTimeMin, lastResetMin, nonce] = tokenAllowance
  return {
    beneficiary: delegate,
    token: getTokenInfoFromBalances(tokenInfoFromBalances, token) ||
      (await getTokenInfoOnChain(token)) || { ...DEFAULT_TOKEN_INFO, address: token },
    amount: amount.toString(),
    spent: spent.toString(),
    resetTimeMin: resetTimeMin.toString(),
    lastResetMin: lastResetMin.toString(),
    nonce: nonce.toString(),
  }
}

export const getTokensForDelegate = async (
  contract: AllowanceModule,
  safeAddress: string,
  delegate: string,
  tokenInfoFromBalances: TokenInfo[],
) => {
  const tokens = await contract.getTokens(safeAddress, delegate)

  return Promise.all(
    tokens.map(async (token) =>
      getTokenAllowanceForDelegate(contract, safeAddress, delegate, token, tokenInfoFromBalances),
    ),
  )
}

export const getSpendingLimits = async (
  provider: JsonRpcProvider,
  safeModules: AddressEx[],
  safeAddress: string,
  chainId: string,
  tokenInfoFromBalances: TokenInfo[],
): Promise<SpendingLimitState[] | undefined> => {
  const spendingLimitModuleAddress = getSpendingLimitModuleAddress(chainId)
  if (!spendingLimitModuleAddress) return

  const isSpendingLimitEnabled = isModuleEnabled(
    safeModules.map((module) => module.value),
    spendingLimitModuleAddress,
  )
  if (!isSpendingLimitEnabled) return

  const contract = getSpendingLimitContract(chainId, provider)
  const delegates = await contract.getDelegates(safeAddress, 0, 100)

  const spendingLimits = await Promise.all(
    delegates.results.map(async (delegate) =>
      getTokensForDelegate(contract, safeAddress, delegate, tokenInfoFromBalances),
    ),
  )
  return spendingLimits.flat().filter(discardZeroAllowance)
}

export const useLoadSpendingLimits = (): AsyncResult<SpendingLimitState[]> => {
  const { safeAddress, safe, safeLoaded } = useSafeInfo()
  const chainId = useChainId()
  const provider = useWeb3ReadOnly()
  const tokenInfoFromBalances = useAppSelector(selectTokens, isEqual)

  const [data, error, loading] = useAsync<SpendingLimitState[] | undefined>(() => {
    if (!provider || !safeLoaded || !safe.modules || !tokenInfoFromBalances) return

    return getSpendingLimits(provider, safe.modules, safeAddress, chainId, tokenInfoFromBalances)
  }, [provider, safeLoaded, safe.modules?.length, safeAddress, chainId, safe.txHistoryTag, tokenInfoFromBalances])

  useEffect(() => {
    if (error) {
      logError(Errors._609, error.message)
    }
  }, [error])

  return [data, error, loading]
}

export default useLoadSpendingLimits
