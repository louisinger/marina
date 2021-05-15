import { connect } from "react-redux"
import SeedRevealView, { SeedRevealProps } from "../../../presentation/onboarding/seed-reveal"
import { RootState } from "../store"

const mapStateToProps = (state: RootState): SeedRevealProps => ({
  onboardingMnemonic: state.onboarding.mnemonic,
})

const SeedReveal = connect(mapStateToProps)(SeedRevealView)

export default SeedReveal