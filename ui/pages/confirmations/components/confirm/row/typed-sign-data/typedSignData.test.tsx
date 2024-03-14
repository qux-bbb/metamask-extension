import React from 'react';
import { render } from '@testing-library/react';

import {
  rawMessageV4,
  unapprovedTypedSignMsgV4,
} from '../../../../../../../test/data/confirmations/typed_sign';
import { ConfirmInfoRowTypedSignData } from './typedSignData';

describe('ConfirmInfoRowTypedSignData', () => {
  it('should match snapshot', () => {
    const { container } = render(
      <ConfirmInfoRowTypedSignData
        data={unapprovedTypedSignMsgV4.msgParams.data}
      />,
    );
    expect(container).toMatchSnapshot();
  });

  it('should return null if data is not defined', () => {
    const { container } = render(<ConfirmInfoRowTypedSignData data={''} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('should not render data whose type is not defined', () => {
    (rawMessageV4.message as any).do_not_display = 'one';
    (rawMessageV4.message as any).do_not_display_2 = {
      do_not_display: 'two',
    };
    unapprovedTypedSignMsgV4.msgParams.data = JSON.stringify(rawMessageV4);
    const { queryByText } = render(
      <ConfirmInfoRowTypedSignData
        data={unapprovedTypedSignMsgV4.msgParams.data}
      />,
    );

    expect(queryByText('do_not_display')).not.toBeInTheDocument();
    expect(queryByText('one')).not.toBeInTheDocument();
    expect(queryByText('do_not_display_2')).not.toBeInTheDocument();
    expect(queryByText('two')).not.toBeInTheDocument();
  });
});
