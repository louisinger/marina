import { connect } from 'react-redux';
import { RootReducerState } from '../../../domain/common';
import EndOfFlowOnboardingView, {
  EndOfFlowProps,
} from '../../../presentation/onboarding/end-of-flow';
import { selectEsploraURL } from '../selectors/app.selector';
import { hasMnemonicSelector } from '../selectors/wallet.selector';

const mapStateToProps = (state: RootReducerState): EndOfFlowProps => {
  return {
    mnemonic: state.onboarding.mnemonic,
    password: state.onboarding.password,
    isFromPopupFlow: state.onboarding.isFromPopupFlow,
    network: state.app.network,
    hasMnemonicRegistered: hasMnemonicSelector(state),
    explorerURL: selectEsploraURL(state),
  };
};

const EndOfFlow = connect(mapStateToProps)(EndOfFlowOnboardingView);

export default EndOfFlow;
