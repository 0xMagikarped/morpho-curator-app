# BNB Chain / Lista Moolah — Contract Inventory

> Source of truth for every Moolah address the app talks to on BNB Chain (chainId 56).
> Verified from Lista's published deploy scripts (`github.com/lista-dao/moolah`) and
> SDK config (`github.com/lista-dao/lending-sdk`) in April 2026.

All explorer links: `https://bscscan.com/address/{addr}`.

## Why Moolah is not vanilla Morpho

Moolah is Lista DAO's fork of Morpho Blue + MetaMorpho V1. Market math (LLTV, IRM,
utilisation, APY) is preserved; everything else — governance, upgradeability, roles,
timelocks, vault lifecycle, market creation, liquidations, revenue — uses different
contracts with different semantics. See `CLAUDE.md` and the vault adapter at
`src/lib/vault/adapter.ts` for how the app branches on `VaultFlavor`.

## Core

| Contract | Address | Role |
|---|---|---|
| Moolah singleton (ERC1967 proxy) | `0x8F73b65B4caAf64FBA2aF91cC5D4a2A1318E5D8C` | Morpho Blue fork. Reads + writes. |
| MoolahVaultFactory (ERC1967 proxy) | `0x2a0Cb6401FD3c6196750dc6b46702040761D9671` | Deploys new MoolahVaults. |
| MoolahVault shared implementation (18-dec) | `0xA1f832c7C7ECf91A53b4ff36E0ABdb5133C15982` | Current impl used by factory. Older: `0x8F9475F2F5fEcccce21A14971DdE47498C2e51C3`. |
| MarketFactory (ERC1967 proxy) | `0xce26859127d236a61f168d2d0905f77d7E286Ab2` | Wires markets to liquidators, providers, IRMs. OPERATOR-gated. |
| MarketFactory implementation | `0x12bb76cd6a2a1ccf2ac2cff64072fed6d8a128e3` | Used by the proxy above. |
| VaultAllocator (Lista PublicAllocator) | `0x9ECF66f016FCaA853FdA24d223bdb4276E5b524a` | Cross-vault flash reallocations. |

**MarketFactory proxy**: Confirmed via `docs.bsc.lista.org/llms-full.txt`
(table lists `MarketFactory = 0xce268591…E286Ab2` alongside MoolahVaultFactory
and MoolahVaultManager) and on-chain ERC1967 implementation-slot verification.
Hardcoded in `src/config/chains.ts` under the BNB entry.

Resolution path in the app (`src/lib/moolah/resolveMarketFactory.ts`):

1. **Hardcoded config** (fastest, canonical).
2. **`VITE_BNB_MARKET_FACTORY` env override** (ops flexibility without a rebuild).
3. **On-chain auto-discovery** (safety net): probes the hinted address with
   `hasRole(keccak256("OPERATOR"), Lista-operator-Safe)` — if true, the proxy
   is a MarketFactory. Results cached in localStorage for 30 days.

## IRMs

| Contract | Address |
|---|---|
| AdaptiveCurveIRM (variable) | `0xFe7dAe87Ebb11a7BEB9F534BB23267992d9cDe7c` |
| ALPHA_IRM / fixed rate | `0x5F9f9173B405C6CEAfa7f98d09e4B8447e9797E6` |
| Broker RateCalculator | `0xF81A3067ACF683B7f2f40a22bCF17c8310be2330` |

> **Correction vs pre-April-2026 config**: the app previously had the Ethereum IRM
> addresses (`0x8b7d…F990` and `0x9A7c…22e1`) wired under BNB. Fixed during Stage 1 —
> BSC IRMs are distinct.

## Liquidator stack

| Contract | Address |
|---|---|
| Liquidator | `0x6a87C15598929B2db22cF68a9a0dDE5Bf297a59a` |
| PublicLiquidator | `0x882475d622c687b079f149B69a15683FCbeCC6D9` |
| BrokerLiquidator | `0x3AA647a1e902833b61E503DbBFbc58992daa4868` |
| ListaRevenueDistributor | `0x34B504A5CF0fF41F8A480580533b6Dda687fa3Da` |
| BuyBack | `0x3b99A4177E3f430590A8473f353dD87a5a2e1BfC` |
| AutoBuyBack | `0xFfd3a57E8DB4f51FA01c72F06Ff30BDFDa9908e6` |

Revenue chain: `Liquidator → ListaRevenueDistributor → BuyBack / AutoBuyBack → LISTA`.

## Providers (auto-yield collateral)

| Contract | Address | Used by |
|---|---|---|
| BNBProvider (Lista WBNB Vault) | `0x367384C54756a25340c63057D87eA22d47Fd5701` | Markets with WBNB as loan or collateral. |
| slisBNBProvider | `0x33f7A980a246f9B8FEA2254E3065576E127D4D5f` | Markets with slisBNB collateral. |
| Generic SmartProvider | `0xcc93cb664ed2abf4f428440a7868fdc3c30e5a1b` | Fallback for LST collateral. |

## Governance / roles

| Role | Address |
|---|---|
| vaultAdmin (Lista DAO Safe) | `0x07D274a68393E8b8a2CCf19A2ce4Ba3518735253` |
| OPERATOR (MarketFactory) | `0x8d388136d578dCD791D081c6042284CED6d9B0c6` |
| PAUSER (singleton + MarketFactory) | `0xEEfebb1546d88EA0909435DF6f615084DD3c5Bd8` |
| Deployer | `0xd7e38800201d6a42c408bf79d8723740c4e7f631` |

Role constants (keccak256 of the literal string):
- `OPERATOR = keccak256("OPERATOR")`
- `PAUSER = keccak256("PAUSER")`
- `MANAGER_ROLE = keccak256("MANAGER")`
- `CURATOR_ROLE = keccak256("CURATOR")`
- `ALLOCATOR_ROLE = keccak256("ALLOCATOR")`
- `DEFAULT_ADMIN_ROLE = 0x00…00`

## Known vaults

All are MoolahVault (ERC1967 proxy → shared impl). Asset decimals = 18 (factory-enforced).

| Name | Address | Asset |
|---|---|---|
| Lista WBNB Vault | `0x57134a64B7cD9F9eb72F8255A671F5Bf2fe3E2d0` | WBNB |
| Lista USD1 Vault | `0xfa27f172e0b6ebcEF9c51ABf817E2cb142FbE627` | USD1 |
| Re7 USD1 Vault | `0x02a5ca3a749855d1002a78813e679584a96646d0` | USD1 |
| Native BSC USDT Vault | `0xce51d66343ed1ffaf82432b7436b5a128445ef2b` | USDT |

Each vault is paired with **two** `TimelockController` contracts (managerTimeLock +
curatorTimeLock) at addresses that are emitted in the `VaultCreated` event by the
factory. They are read live via `getRoleMember(MANAGER_ROLE, 0)` and
`getRoleMember(CURATOR_ROLE, 0)` on the vault; see `src/lib/vault/adapter.ts`.

## Tokens

| Symbol | Address | Decimals |
|---|---|---|
| WBNB | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` | 18 |
| USDT (BSC-USD) | `0x55d398326f99059fF775485246999027B3197955` | 18 |
| USD1 | `0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d` | 18 |
| LISTA | `0xFceB31A79F71AC9CBDCF853519c1b12D379EdC46` | 18 |
| slisBNB | `0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B` | 18 |
| BTCB | `0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c` | 18 |
| solvBTC | `0x4aae823a6a0b376De6A78e74eCC5b079d38cBCf7` | 18 |

## Oracle

| Contract | Address |
|---|---|
| MultiOracle / ResilientOracle | `0xf3afD82A4071f272F403dC176916141f44E6c750` |
| OracleAdaptor (SDK) | `0x35c673a0a56edb743a8cf67bcd96d0eab8af4bbe` |

## Factory ABIs (verified from source — Solidity 0.8.34)

```solidity
// MoolahVaultFactory.createMoolahVault
function createMoolahVault(
  address manager,
  address curator,
  address guardian,
  uint256 timeLockDelay,
  address asset,
  string memory name,
  string memory symbol
) external returns (address vault, address managerTimeLock, address curatorTimeLock);
```

```solidity
// MarketFactory.createMarket — OPERATOR-only
function createMarket(
  MarketParams calldata params,
  address[] calldata liquidatorWhitelist,
  address[] calldata supplyWhitelist,
  bool liquidatorMarketWhitelist,
  bool liquidatorSmartProvider
) external;

// MarketFactory.createFixedTermMarket — OPERATOR-only
struct FixedTermMarketParams {
  address broker;
  address loanToken;
  address collateralToken;
  address irm;
  uint256 lltv;
  uint256 ratePerSecond;
  uint256 maxRatePerSecond;
}
function createFixedTermMarket(FixedTermMarketParams calldata p)
  external returns (Id);
```

Events:
- `CommonMarketDeployed(MarketParams, Id)`
- `BrokerMarketDeployed(FixedTermMarketParams, Id, address broker)`

## Moolah singleton extensions (beyond Morpho Blue)

Read-only surfaces the app uses:
- `minLoanValue()` → `uint256` in 8-decimal oracle precision (seeded `15e8` = $1.50).
- `defaultMarketFee()` → `uint256`.
- `paused()` → `bool`. Drives the global pause banner.
- `whiteList(Id, address)` → supply-whitelist membership.
- `liquidationWhitelist(Id, address)` → liquidation-whitelist membership.
- `marketWhitelistEnabled(Id)` → `bool` flag on the market.
- `providers(Id, address)` → `address` of the LST smart-provider, `0x0` if none.
- `brokers(Id)` → `address` of the broker, `0x0` if not a fixed-term market.
- `vaultBlacklist(address)` → `bool`.
- `flashLoanTokenBlacklist(address)` → `bool`.

## Items verified ⚠ at runtime only

- Current on-chain value of `minLoanValue()`.
- Current on-chain value of `defaultMarketFee()`.
- Current on-chain value of `paused()`.
- Exact list of entries in `vaultBlacklist` and `flashLoanTokenBlacklist`.
- Proxy address of MarketFactory (see note above).
- Per-vault `managerTimeLock`, `curatorTimeLock`, `minDelay` — read live by the adapter.
- Per-market `brokers[id]`, `providers[id]` — read live by the markets list.

## Sources

- `github.com/lista-dao/moolah` — `script/deploy_marketFactory.sol`, `src/moolah/MarketFactory.sol`, `src/moolah-vault/interfaces/IMoolahVaultFactory.sol`
- `github.com/lista-dao/lending-sdk` — `packages/moolah-sdk-core/src/contracts/config.ts`
- `docs.bsc.lista.org`
- BscScan proxy resolutions for every address above.
