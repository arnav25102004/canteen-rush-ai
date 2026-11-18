import { createRegistry } from './registry';
import { searchMenu } from './searchMenu';
import { getCanteenMenu } from './getCanteenMenu';
import { findSlots } from './findSlots';
import { getMyRecentOrders, getRecommendationsTool, getMyPoints } from './myData';
import { proposeOrder, showItems } from './cardTools';

/**
 * The complete tool list. There is deliberately no place, pay, cancel or wallet tool:
 * the assistant reads the menu and proposes cards, and the student orders at checkout.
 */
export const ALL_TOOLS = [searchMenu, getCanteenMenu, findSlots, getMyRecentOrders, getRecommendationsTool, getMyPoints, proposeOrder, showItems];

export const toolRegistry = createRegistry(ALL_TOOLS);

export { searchMenu, getCanteenMenu, findSlots, getMyRecentOrders, getRecommendationsTool, getMyPoints, proposeOrder, showItems };
