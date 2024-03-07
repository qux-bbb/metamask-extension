import { useMemo } from 'react';
import { shallowEqual, useSelector } from 'react-redux';
import { getTokenExchangeRates } from '../../../../selectors';
import { isEqualCaseInsensitive } from '../../../../../shared/modules/string-utils';
import { Numeric } from '../../../../../shared/modules/Numeric';
import { getConversionRate } from '../../../../ducks/metamask/metamask';

/**
 * A hook that returns the exchange rate of the given token –– assumes native if no token address is passed.
 *
 * @param tokenAddress - the address of the token. If not provided, the function will return the native exchange rate.
 * @returns the exchange rate of the token
 */
export default function useTokenExchangeRate(
  tokenAddress?: string,
): Numeric | undefined {
  const selectedNativeConversionRate = useSelector(getConversionRate);
  const nativeConversionRate = new Numeric(selectedNativeConversionRate, 10);

  const contractExchangeRates = useSelector(
    getTokenExchangeRates,
    shallowEqual,
  );

  return useMemo(() => {
    if (!tokenAddress) {
      return nativeConversionRate;
    }

    const contractExchangeTokenKey = Object.keys(contractExchangeRates).find(
      (key) => isEqualCaseInsensitive(key, tokenAddress),
    );

    const contractExchangeRate =
      contractExchangeTokenKey &&
      contractExchangeRates[contractExchangeTokenKey];

    if (!contractExchangeRate) {
      return undefined;
    }

    return new Numeric(contractExchangeRate, 10).times(nativeConversionRate);
  }, [tokenAddress, nativeConversionRate, contractExchangeRates]);
}
