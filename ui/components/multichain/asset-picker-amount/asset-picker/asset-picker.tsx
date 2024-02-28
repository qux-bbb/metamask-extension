import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import {
  AvatarTokenSize,
  Icon,
  IconName,
  IconSize,
  AvatarToken,
  Text,
  Box,
} from '../../../component-library';
import { Asset } from '../../../../ducks/send';
import {
  AlignItems,
  BackgroundColor,
  BorderRadius,
  Display,
  TextVariant,
} from '../../../../helpers/constants/design-system';
import { AssetType } from '../../../../../shared/constants/transaction';
import { AssetPickerModal } from '../asset-picker-modal/asset-picker-modal';
import { getNativeCurrency } from '../../../../ducks/metamask/metamask';
import { getNativeCurrencyImage, getTokenList } from '../../../../selectors';
import Tooltip from '../../../ui/tooltip';
import { LARGE_SYMBOL_LENGTH } from '../constants';

export interface AssetPickerProps {
  asset: Asset;
  onAssetChange: (newAsset: Asset) => void;
}

// A component that lets the user pick from a list of assets.
export function AssetPicker({ asset, onAssetChange }: AssetPickerProps) {
  const nativeCurrencySymbol = useSelector(getNativeCurrency);
  const nativeCurrencyImageUrl = useSelector(getNativeCurrencyImage);
  const tokenList: Record<string, any> = useSelector(getTokenList);

  const [showAssetPickerModal, setShowAssetPickerModal] = useState(false);

  let image: string | undefined;

  if (asset.type === AssetType.native) {
    image = nativeCurrencyImageUrl;
  } else if (tokenList && asset.details) {
    image = tokenList[asset.details.address?.toLowerCase()]?.iconUrl;
  }

  const symbol =
    asset.type === AssetType.native
      ? nativeCurrencySymbol
      : asset.details?.symbol;

  const isSymbolLong = symbol?.length > LARGE_SYMBOL_LENGTH;

  const shortFormSymbol = isSymbolLong
    ? `${symbol.substring(0, LARGE_SYMBOL_LENGTH - 1)}...`
    : symbol;

  return (
    <>
      {/* This is the Modal that ask to choose token to send */}
      <AssetPickerModal
        isOpen={showAssetPickerModal}
        onClose={() => setShowAssetPickerModal(false)}
        asset={asset}
        onAssetChange={onAssetChange}
      />

      {/* TOKEN PICKER */}
      <Box
        className="asset-picker"
        display={Display.Flex}
        alignItems={AlignItems.center}
        gap={3}
        padding={2}
        backgroundColor={BackgroundColor.transparent}
        borderRadius={BorderRadius.pill}
        onClick={() => setShowAssetPickerModal(true)}
      >
        <AvatarToken src={image} size={AvatarTokenSize.Md} showHalo />
        <Tooltip disabled={!isSymbolLong} title={symbol} position="bottom">
          <Text variant={TextVariant.bodyMd}>{shortFormSymbol}</Text>
        </Tooltip>
        <Icon name={IconName.ArrowDown} size={IconSize.Sm} />
      </Box>
    </>
  );
}
