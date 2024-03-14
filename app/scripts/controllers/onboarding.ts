import { ObservableStore } from '@metamask/obs-store';
import log from 'loglevel';
import { FirstTimeFlowType } from '../../../shared/constants/onboarding';

/**
 * The Onboarding Controller State Object
 *
 * @property seedPhraseBackedUp - Indicates whether the user has completed
 * the seed phrase backup challenge
 * @property firsTimeFlowType - Indicates which method the user chose during
 * onboarding to instantiate their account. Either create a new SRP or import
 * via one.
 * @property completedOnboarding - Indicates whether the user has completed the
 * onboarding flow
 * @property onboardingTabs - A record of the tabs that have initiated
 * onboarding
 */
export type OnboardingControllerState = {
  seedPhraseBackedUp: boolean | null;
  firstTimeFlowType: FirstTimeFlowType | null;
  completedOnboarding: boolean;
  onboardingTabs?: Record<string, string>;
};

/**
 * Controller responsible for maintaining
 * state related to onboarding
 */
export default class OnboardingController {
  store: ObservableStore<OnboardingControllerState>;

  /**
   * Creates an instance of the OnboardingController
   *
   * @param opts - The options for the controller
   * @param opts.initState - The initial state of the controller
   */
  constructor(opts: { initState?: OnboardingControllerState } = {}) {
    const initialTransientState = {
      onboardingTabs: {},
    };
    const initState = {
      seedPhraseBackedUp: null,
      firstTimeFlowType: null,
      completedOnboarding: false,
      ...opts.initState,
      ...initialTransientState,
    };
    this.store = new ObservableStore(initState);
  }

  setSeedPhraseBackedUp(newSeedPhraseBackUpState: boolean) {
    this.store.updateState({
      seedPhraseBackedUp: newSeedPhraseBackUpState,
    });
  }

  /**
   * Sets the completedOnboarding state to true, indicating that the user has
   * completed the onboarding process.
   */
  async completeOnboarding() {
    this.store.updateState({
      completedOnboarding: true,
    });
    return true;
  }

  /**
   * Setter for the `firstTimeFlowType` property
   *
   * @param type - The new value for the `firstTimeFlowType` property
   */
  setFirstTimeFlowType(type: FirstTimeFlowType) {
    this.store.updateState({ firstTimeFlowType: type });
  }

  /**
   * Registering a site as having initiated onboarding
   *
   * @param location - The location of the site registering
   * @param tabId - The id of the tab registering
   */
  registerOnboarding = async (location: string, tabId: string) => {
    if (this.store.getState().completedOnboarding) {
      log.debug('Ignoring registerOnboarding; user already onboarded');
      return;
    }
    const onboardingTabs = { ...this.store.getState().onboardingTabs };
    if (!onboardingTabs[location] || onboardingTabs[location] !== tabId) {
      log.debug(
        `Registering onboarding tab at location '${location}' with tabId '${tabId}'`,
      );
      onboardingTabs[location] = tabId;
      this.store.updateState({ onboardingTabs });
    }
  };
}
