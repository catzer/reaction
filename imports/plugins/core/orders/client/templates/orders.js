import _ from "lodash";
import accounting from "accounting-js";
import { Meteor } from "meteor/meteor";
import { Template } from "meteor/templating";
import { Reaction, i18next } from "/client/api";
import { Orders, Shops } from "/lib/collections";
import OrdersActionContainer from "../containers/ordersActionContainer";
import {
  PACKAGE_NAME,
  ORDER_LIST_FILTERS_PREFERENCE_NAME,
  ORDER_LIST_SELECTED_ORDER_PREFERENCE_NAME,
  DEFAULT_FILTER_NAME
} from "../../lib/constants";

const orderFilters = [{
  name: "new",
  label: "New"
}, {
  name: "processing",
  label: "Processing"
}, {
  name: "completed",
  label: "Completed"
}];

const OrderHelper =  {
  makeQuery(filter) {
    let query = {};

    switch (filter) {
      // New orders
      case "new":
        query = {
          "workflow.status": "new"
        };
        break;

      // Orders that have yet to be captured & shipped
      case "processing":
        query = {
          "workflow.status": "coreOrderWorkflow/processing"
        };
        break;

      // Orders that have been shipped, based on if the items have been shipped
      case "shipped":
        query = {
          "items.workflow.status": "coreOrderItemWorkflow/shipped"
        };
        break;

      // Orders that are complete, including all items with complete status
      case "completed":
        query = {
          "workflow.status": "coreOrderWorkflow/completed",
          "items.workflow.workflow": {
            $in: ["coreOrderItemWorkflow/completed"]
          }
        };
        break;

      // Orders that have been captured, but not yet shipped
      case "captured":
        query = {
          "billing.paymentMethod.status": "completed",
          "shipping.shipped": false
        };
        break;

      case "canceled":
        query = {
          "workflow.status": "canceled"
        };
        break;

      // Orders that have been refunded partially or fully
      case "refunded":
        query = {
          "billing.paymentMethod.status": "captured",
          "shipping.shipped": true
        };
        break;
      default:
    }

    return query;
  }
};

Template.orders.onCreated(function () {
  this.state = new ReactiveDict();
  this.state.setDefault({
    orders: []
  });

  const filterName = this.data && this.data.filter && this.data.filter.name || "new";
  Reaction.setUserPreferences(PACKAGE_NAME, ORDER_LIST_FILTERS_PREFERENCE_NAME, filterName);

  // Watch for updates to the subscription and query params
  // fetch available orders
  this.autorun(() => {
    this.subscribe("Orders");
    const filter = Reaction.getUserPreferences(PACKAGE_NAME, ORDER_LIST_FILTERS_PREFERENCE_NAME, DEFAULT_FILTER_NAME);
    const query = OrderHelper.makeQuery(filter);
    const orders = Orders.find(query).fetch();

    this.state.set("orders", orders);
  });

  // Watch for updates to shop collection
  this.autorun(() => {
    const shop = Shops.findOne({});

    // Update currency information, this is passed to child components containing
    // Numeric inputs
    this.state.set("currency", shop.currencies[shop.currency]);
  });
});

/**
 * orders helpers
 */
Template.orders.helpers({
  FilterComponent() {
    return {
      component: OrdersActionContainer,
      onActionClick(filter) {
        Reaction.setUserPreferences(PACKAGE_NAME, ORDER_LIST_FILTERS_PREFERENCE_NAME, filter.name);
        Reaction.setUserPreferences(PACKAGE_NAME, ORDER_LIST_SELECTED_ORDER_PREFERENCE_NAME, null);
      }
    };
  },
  itemProps(order) {
    return {
      order,
      currencyFormat: Template.instance().state.get("currency")
    };
  },

  orders() {
    return Template.instance().state.get("orders") || false;
  },

  currentFilterLabel() {
    const foundFilter = _.find(orderFilters, (filter) => {
      return filter.name === Reaction.Router.getQueryParam("filter");
    });

    if (foundFilter) {
      return foundFilter.label;
    }

    return "";
  },
  activeClassname(orderId) {
    if (Reaction.Router.getQueryParam("_id") === orderId) {
      return "panel-info";
    }
    return "panel-default";
  }
});

Template.ordersListItem.helpers({
  order() {
    return Template.currentData().order;
  },
  activeClassname(orderId) {
    // const Reaction.setUserPreferences(PACKAGE_NAME, ORDER_LIST_FILTERS_PREFERENCE_NAME, filter.name)
    const selectedOrderId = Reaction.getUserPreferences(PACKAGE_NAME, ORDER_LIST_SELECTED_ORDER_PREFERENCE_NAME);

    if (selectedOrderId === orderId) {
      return "active";
    }
    return "";
  },

  orderIsNew(order) {
    return order.workflow.status === "new";
  }
});

Template.ordersListItem.events({
  "click [data-event-action=selectOrder]": function (event) {
    event.preventDefault();
    const instance = Template.instance();

    // Set selected order in user preference
    Reaction.setUserPreferences(PACKAGE_NAME, ORDER_LIST_SELECTED_ORDER_PREFERENCE_NAME, instance.data.order._id);

    // Show the action view - detail view
    Reaction.setActionViewDetail({
      label: "Order Details",
      i18nKeyLabel: "orderWorkflow.orderDetails",
      data: {
        order: instance.data.order
      },
      props: {
        size: "large"
      },
      template: "coreOrderWorkflow"
    });
  },
  "click [data-event-action=startProcessingOrder]": function (event) {
    event.preventDefault();
    const instance = Template.instance();
    const isActionViewOpen = Reaction.isActionViewOpen();
    const { order } = instance.data;


    if (order.workflow.status === "new") {
      Meteor.call("workflow/pushOrderWorkflow", "coreOrderWorkflow", "processing", order);

      // send notification to order owner
      const userId = order.userId;
      const type = "orderAccepted";
      const prefix = Reaction.getShopPrefix();
      const url = `${prefix}/notifications`;
      const sms = true;
      Meteor.call("notification/send", userId, type, url, sms);
    }

    Reaction.setUserPreferences(PACKAGE_NAME, ORDER_LIST_FILTERS_PREFERENCE_NAME, "processing");

    // toggle detail views
    if (isActionViewOpen === false) {
      Reaction.showActionView({
        label: "Order Details",
        i18nKeyLabel: "orderWorkflow.orderDetails",
        data: { order },
        props: {
          size: "large"
        },
        template: "coreOrderWorkflow"
      });
    }
  }
});

Template.orderListFilters.onCreated(function () {
  this.state = new ReactiveDict();

  this.autorun(() => {
    const queryFilter = Reaction.Router.getQueryParam("filter");
    this.subscribe("Orders");

    const filters = orderFilters.map((filter) => {
      filter.label = i18next.t(`order.filter.${filter.name}`, { defaultValue: filter.label });
      filter.i18nKeyLabel = `order.filter.${filter.name}`;
      filter.count = Orders.find(OrderHelper.makeQuery(filter.name)).count();

      if (queryFilter) {
        filter.active = queryFilter === filter.name;
      }

      return filter;
    });

    this.state.set("filters", filters);
  });
});

Template.orderListFilters.events({
  "click [role=tab]": (event) => {
    event.preventDefault();
    const filter = event.currentTarget.getAttribute("data-filter");
    const isActionViewOpen = Reaction.isActionViewOpen();
    if (isActionViewOpen === true) {
      Reaction.hideActionView();
    }

    Reaction.setUserPreferences(PACKAGE_NAME, ORDER_LIST_FILTERS_PREFERENCE_NAME, filter);
    Reaction.setUserPreferences(PACKAGE_NAME, ORDER_LIST_SELECTED_ORDER_PREFERENCE_NAME, null);
  }
});

Template.orderListFilters.helpers({
  filters() {
    return Template.instance().state.get("filters");
  },

  activeClassname(item) {
    if (item.active === true) {
      return "active";
    }
    return "";
  }
});

/**
 * orderStatusDetail
 *
 * order state tracking
 *
 * @returns orderStatusDetails
 */
Template.orderStatusDetail.onCreated(function () {
  this.state = new ReactiveDict();
  this.state.setDefault({
    orders: []
  });

  // Watch for updates to the subscription and query params
  // fetch available orders
  this.autorun(() => {
    this.subscribe("Orders");
    const filter = Reaction.Router.getQueryParam("filter");
    const query = OrderHelper.makeQuery(filter);
    const orders = Orders.find(query).fetch();

    this.state.set("orders", orders);
  });
});

Template.orderStatusDetail.helpers({
  // helper to format currency
  formatAmount(value) {
    let amount = value || "";
    if (typeof value === "number") {
      amount = accounting.toFixed(value, 2);
    }
    return amount;
  },
  // order age helper
  orderAge: function () {
    return moment(this.createdAt).fromNow();
  },

  shipmentMethod: function () {
    return this.shipping[0].shipmentMethod;
  },

  shipmentTracking: function () {
    if (this.shipping[0].tracking) {
      return this.shipping[0].tracking;
    }
    return "";
  },

  shipmentStatus() {
    const self = this;
    const shipment = this.shipping[0];

    // check first if it was delivered
    if (shipment.delivered) {
      return {
        delivered: true,
        shipped: true,
        status: "success",
        label: i18next.t("orderShipping.delivered")
      };
    }

    const shipped = _.every(shipment.items, (shipmentItem) => {
      for (const fullItem of self.items) {
        if (fullItem._id === shipmentItem._id) {
          if (fullItem.workflow) {
            if (_.isArray(fullItem.workflow.workflow)) {
              return _.includes(fullItem.workflow.workflow, "coreOrderItemWorkflow/completed");
            }
          }
        }
      }
    });

    if (shipped) {
      return {
        delivered: false,
        shipped: true,
        status: "success",
        label: i18next.t("orderShipping.shipped")
      };
    }

    return {
      delivered: false,
      shipped: false,
      status: "info",
      label: i18next.t("orderShipping.notShipped")
    };
  }
});
