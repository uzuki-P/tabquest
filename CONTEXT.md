# Tabquest

A bill-splitting app for a group of friends who place group orders to get better discounts. It divides the receipt among the people who ordered and gamifies paying.

## Language

**Player**:
Any person on a bill. Everyone on a bill is a player, even someone who will only ever order once.
_Avoid_: Customer, participant, user

**Bill**:
The whole receipt for one group order, divided among the players on it.

**Split**:
The amount a player owes on a bill, after their proportional share of any discount.

**Allocation**:
A quantity of a bill item, or a share of a bill adjustment, assigned to one player on the bill. Allocations are the inputs a Split is computed from.

**Tip**:
The difference between what a player pays and their split. Positive when they round their payment up for convenience, negative when they pay less than their split.
_Avoid_: Round-up, overpay

**Spending**:
The total of a player's splits over a period, such as a month. Spending counts what a player owes, whether or not they have paid yet.

**Spending leaderboard**:
The monthly ranking of players by spending, highest first.

**Tip leaderboard**:
The monthly ranking of players by the sum of their tips in that month.
