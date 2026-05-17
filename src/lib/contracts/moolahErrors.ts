/**
 * Moolah (Lista DAO) vault custom-error ABI fragments (PR 1 — audit finding D5).
 *
 * SOURCE OF TRUTH — verbatim from the VERIFIED on-chain contract (no hand-rolling):
 *   contract : MoolahVault shared implementation
 *   address  : 0xA1f832c7C7ECf91A53b4ff36E0ABdb5133C15982 (BNB Chain / chainId 56)
 *   explorer : https://bscscan.com/address/0xA1f832c7C7ECf91A53b4ff36E0ABdb5133C15982#code
 *   via      : Etherscan v2 multichain getsourcecode (chainid=56), fetched through the
 *              defi-data skill on 2026-05-16; ABI .filter(e => e.type === "error").
 *
 * Moolah is a Morpho Blue + MetaMorpho V1 fork; it is NOT covered by
 * @morpho-org/blue-sdk-viem, hence sourced separately from the verified BSC contract.
 * The Moolah singleton (Morpho-Blue-fork core) uses string reverts + only OZ infra
 * errors, so only the MetaMorpho-fork *vault* error set is exported here.
 *
 * 54 custom errors.
 */

export const MOOLAH_VAULT_ERRORS = [
  {"inputs":[],"name":"AccessControlBadConfirmation","type":"error"},
  {"inputs":[{"internalType":"address","name":"account","type":"address"},{"internalType":"bytes32","name":"neededRole","type":"bytes32"}],"name":"AccessControlUnauthorizedAccount","type":"error"},
  {"inputs":[{"internalType":"address","name":"target","type":"address"}],"name":"AddressEmptyCode","type":"error"},
  {"inputs":[],"name":"AllCapsReached","type":"error"},
  {"inputs":[],"name":"AlreadyPending","type":"error"},
  {"inputs":[],"name":"AlreadySet","type":"error"},
  {"inputs":[{"internalType":"Id","name":"id","type":"bytes32"}],"name":"DuplicateMarket","type":"error"},
  {"inputs":[],"name":"ECDSAInvalidSignature","type":"error"},
  {"inputs":[{"internalType":"uint256","name":"length","type":"uint256"}],"name":"ECDSAInvalidSignatureLength","type":"error"},
  {"inputs":[{"internalType":"bytes32","name":"s","type":"bytes32"}],"name":"ECDSAInvalidSignatureS","type":"error"},
  {"inputs":[{"internalType":"address","name":"implementation","type":"address"}],"name":"ERC1967InvalidImplementation","type":"error"},
  {"inputs":[],"name":"ERC1967NonPayable","type":"error"},
  {"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"allowance","type":"uint256"},{"internalType":"uint256","name":"needed","type":"uint256"}],"name":"ERC20InsufficientAllowance","type":"error"},
  {"inputs":[{"internalType":"address","name":"sender","type":"address"},{"internalType":"uint256","name":"balance","type":"uint256"},{"internalType":"uint256","name":"needed","type":"uint256"}],"name":"ERC20InsufficientBalance","type":"error"},
  {"inputs":[{"internalType":"address","name":"approver","type":"address"}],"name":"ERC20InvalidApprover","type":"error"},
  {"inputs":[{"internalType":"address","name":"receiver","type":"address"}],"name":"ERC20InvalidReceiver","type":"error"},
  {"inputs":[{"internalType":"address","name":"sender","type":"address"}],"name":"ERC20InvalidSender","type":"error"},
  {"inputs":[{"internalType":"address","name":"spender","type":"address"}],"name":"ERC20InvalidSpender","type":"error"},
  {"inputs":[{"internalType":"uint256","name":"deadline","type":"uint256"}],"name":"ERC2612ExpiredSignature","type":"error"},
  {"inputs":[{"internalType":"address","name":"signer","type":"address"},{"internalType":"address","name":"owner","type":"address"}],"name":"ERC2612InvalidSigner","type":"error"},
  {"inputs":[{"internalType":"address","name":"receiver","type":"address"},{"internalType":"uint256","name":"assets","type":"uint256"},{"internalType":"uint256","name":"max","type":"uint256"}],"name":"ERC4626ExceededMaxDeposit","type":"error"},
  {"inputs":[{"internalType":"address","name":"receiver","type":"address"},{"internalType":"uint256","name":"shares","type":"uint256"},{"internalType":"uint256","name":"max","type":"uint256"}],"name":"ERC4626ExceededMaxMint","type":"error"},
  {"inputs":[{"internalType":"address","name":"owner","type":"address"},{"internalType":"uint256","name":"shares","type":"uint256"},{"internalType":"uint256","name":"max","type":"uint256"}],"name":"ERC4626ExceededMaxRedeem","type":"error"},
  {"inputs":[{"internalType":"address","name":"owner","type":"address"},{"internalType":"uint256","name":"assets","type":"uint256"},{"internalType":"uint256","name":"max","type":"uint256"}],"name":"ERC4626ExceededMaxWithdraw","type":"error"},
  {"inputs":[],"name":"FailedCall","type":"error"},
  {"inputs":[{"internalType":"Id","name":"id","type":"bytes32"}],"name":"InconsistentAsset","type":"error"},
  {"inputs":[],"name":"InconsistentReallocation","type":"error"},
  {"inputs":[{"internalType":"address","name":"account","type":"address"},{"internalType":"uint256","name":"currentNonce","type":"uint256"}],"name":"InvalidAccountNonce","type":"error"},
  {"inputs":[],"name":"InvalidInitialization","type":"error"},
  {"inputs":[{"internalType":"Id","name":"id","type":"bytes32"}],"name":"InvalidMarketRemovalNonZeroCap","type":"error"},
  {"inputs":[{"internalType":"Id","name":"id","type":"bytes32"}],"name":"InvalidMarketRemovalNonZeroSupply","type":"error"},
  {"inputs":[{"internalType":"Id","name":"id","type":"bytes32"}],"name":"InvalidMarketRemovalTimelockNotElapsed","type":"error"},
  {"inputs":[],"name":"MarketNotCreated","type":"error"},
  {"inputs":[{"internalType":"Id","name":"id","type":"bytes32"}],"name":"MarketNotEnabled","type":"error"},
  {"inputs":[],"name":"MaxFeeExceeded","type":"error"},
  {"inputs":[],"name":"MaxQueueLengthExceeded","type":"error"},
  {"inputs":[],"name":"NonZeroCap","type":"error"},
  {"inputs":[],"name":"NotEnoughLiquidity","type":"error"},
  {"inputs":[],"name":"NotInitializing","type":"error"},
  {"inputs":[],"name":"NotProvider","type":"error"},
  {"inputs":[],"name":"NotSet","type":"error"},
  {"inputs":[],"name":"NotWhiteList","type":"error"},
  {"inputs":[],"name":"PendingRemoval","type":"error"},
  {"inputs":[],"name":"RevokeBotFailed","type":"error"},
  {"inputs":[{"internalType":"uint8","name":"bits","type":"uint8"},{"internalType":"uint256","name":"value","type":"uint256"}],"name":"SafeCastOverflowedUintDowncast","type":"error"},
  {"inputs":[{"internalType":"address","name":"token","type":"address"}],"name":"SafeERC20FailedOperation","type":"error"},
  {"inputs":[],"name":"SetBotFailed","type":"error"},
  {"inputs":[{"internalType":"Id","name":"id","type":"bytes32"}],"name":"SupplyCapExceeded","type":"error"},
  {"inputs":[],"name":"TokenMismatch","type":"error"},
  {"inputs":[],"name":"UUPSUnauthorizedCallContext","type":"error"},
  {"inputs":[{"internalType":"bytes32","name":"slot","type":"bytes32"}],"name":"UUPSUnsupportedProxiableUUID","type":"error"},
  {"inputs":[{"internalType":"Id","name":"id","type":"bytes32"}],"name":"UnauthorizedMarket","type":"error"},
  {"inputs":[],"name":"ZeroAddress","type":"error"},
  {"inputs":[],"name":"ZeroFeeRecipient","type":"error"},
] as const;
