require([
  "dojo/ready",
  "dojo/_base/lang",
  "dojo/_base/connect",
  "dojo/_base/array",
  "dojo/_base/fx",
  "dojo/query",
  "dojo/on",
  "dojo/mouse",
  "dojo/dom",
  "dojo/dom-construct",
  "dojo/dom-class",
  "dojo/dom-geometry",
  "dojo/dom-attr",
  "dojo/_base/Deferred",
  "dojo/DeferredList",
  "dojo/date/locale",
  "dijit/registry",
  "dijit/Dialog",
  "dijit/popup",
  "dijit/Tooltip",
  "dijit/TooltipDialog",
  "dijit/form/Button",
  "put-selector/put",
  "esri/request",
  "esri/kernel",
  "esri/config",
  "dojo/i18n!esri/nls/jsapi",
  "esri/arcgis/utils",
  "esri/arcgis/Portal",
  "esri/IdentityManager"
], function (ready, lang, connect, array, fx, query, on, mouse, dom, domConstruct, domClass, domGeom, domAttr, Deferred, DeferredList, locale, registry, Dialog, popup, Tooltip, TooltipDialog, Button, put, esriRequest, esriKernel, esriConfig, bundle, arcgisUtils, esriPortal, IdentityManager) {

  var portalUser;
  var requestTimeoutSeconds = 60;
  var displayStatusTimeout = null;
  var accessTypes = ["private", "org", "shared", "public"];
  var itemTypes = {
    services: 'type:service -type:"service definition" -typekeywords:tool',
    webmaps: 'type:"web map" -type:"web mapping application"'
  };
  var portalUrlList = [
    document.location.protocol + "//www.arcgis.com"
  ];

  /**
   * ARRAY OF PROBLEMATIC IDS
   * YOU CAN USE THIS ARRAY TO DEBUG OR AVOID ITEMS
   * LOOK AT THE createItemsTable FUNCTION
   */
  var problematicItemIds = [];

  /**
   * PAGE AND DIJITS ARE LOADED AND READY
   */
  ready(function () {

    // PROXY //
    esriConfig.defaults.io.proxyUrl = "./resources/proxy.php";

    // PROTOCOL MISMATCH ERROR //
    esriKernel.id.setProtocolErrorHandler(function () {
      return window.confirm("Protocol Mismatch: is it OK to send your credentials via http?");
    });

    // SECTION TOGGLE //
    query('.sectionTitle').on('click', function (evt) {
      query('.previewTableContainer', evt.target.parentNode).forEach(function (node) {
        domClass.toggle(node, 'dijitOffScreen');
      });
    });
    // CATEGORY TOGGLE //
    query('.titleNode').on('click', function (evt) {
      var access = domAttr.get(evt.target, 'access');
      query('tr[access="' + access + '"]', evt.target.parentNode).forEach(function (node) {
        domClass.toggle(node, 'dijitOffScreen');
      });
    });

    // PICK PORTAL //
    pickPortal().then(lang.hitch(this, function (portalUrl) {
      // SIGN IN //
      signInToPortal(portalUrl).then(lang.hitch(this, function (loggedInUser) {
        // PORTAL USER //
        portalUser = loggedInUser;

        // SIGNED-IN USER //
        dom.byId('portalUser').innerHTML = portalUser.fullName;
        // TODAY'S DATE //
        dom.byId('dateNode').innerHTML = locale.format(new Date(), {
          selector: 'date',
          datePattern: 'MMMM d, yyyy'
        });

        // ORG INFO //
        dom.byId('orgName').innerHTML = lang.replace("'{name}' Organization on {portalName}", portalUser.portal);
        dom.byId('orgThumbnail').src = portalUser.portal.thumbnailUrl;

        // ADD CHECK STATUS BUTTONS //
        addSectionButton('services');
        addSectionButton('webmaps');

        // DISPLAY INITIAL TOOLTIP //
        var servicesRefreshButton = registry.byId('refresh.services');
        Tooltip.show("Click the 'Status Check' button to initiate the process of<br>checking the status of registered services of the organization", refreshButton.domNode);
        on.once(servicesRefreshButton, 'click', lang.hitch(this, function () {
          Tooltip.hide(servicesRefreshButton.domNode);
        }));
        on.once(registry.byId('refresh.webmaps'), 'click', lang.hitch(this, function () {
          Tooltip.hide(servicesRefreshButton.domNode);
        }));


      }), lang.hitch(this, function (error) {
        // INVALID SIGN-IN //
        alert(error.message);
      }));
    }));

    // ============================================================ //


    /**
     *
     * @param portalUrl
     * @returns {*}
     */
    function signInToPortal(portalUrl) {
      var deferred = new Deferred();

      var portal = new esriPortal.Portal(portalUrl);
      portal.on('load', lang.hitch(this, function () {
        //connect.connect(portal,'onLoad',lang.hitch(this,function(){
        portal.signIn().then(lang.hitch(this, function (loggedInUser) {
          // IS USER AND ORG ADMIN //
          if(loggedInUser.role !== 'org_admin') {
            deferred.reject(new Error("This application is designed for Organization Administrators."));
          } else {
            deferred.resolve(loggedInUser);
          }
        }));
      }));

      return deferred.promise;
    }

    /**
     *
     * @param itemType
     */
    function addSectionButton(itemType) {
      var refreshBtnId = lang.replace("refresh.{0}", [itemType]);
      var refreshButton = new Button({
        id: refreshBtnId,
        'class': 'refreshBtn',
        label: 'Status Check',
        title: lang.replace("Check status of {0}", [itemType]),
        onClick: lang.hitch(this, function () {
          displayItemsInOrgByItemType(itemType);
        })
      }, domConstruct.create('span', {}, "title." + itemType));

    }


    /**
     *
     * @param itemType
     */
    function displayItemsInOrgByItemType(itemType) {
      var deferred = new Deferred();

      var itemCheckDeferredArray = array.map(accessTypes, lang.hitch(this, function (access, accessIndex) {
        return displayItemsInOrgByItemTypeAndAccess(itemType, access, (accessIndex * 500));
      }));

      var itemCheckDeferredList = new DeferredList(itemCheckDeferredArray);
      itemCheckDeferredList.then(deferred.resolve, deferred.reject);

      return deferred.promise;
    }

    /**
     *
     * @param itemType
     * @param access
     * @param delay
     * @returns {*}
     */
    function displayItemsInOrgByItemTypeAndAccess(itemType, access, delay) {
      var deferred = new Deferred();

      var tableNodeId = lang.replace("table.{0}.{1}", [itemType, access]);
      var tableNode = dom.byId(tableNodeId);
      if(tableNode) {
        setTimeout(lang.hitch(this, function () {
          getItemsInOrgByItemTypeAndAccess(itemType, access).then(lang.hitch(this, function (items) {
            createItemsTable(items, itemType, access).then(lang.hitch(this, function () {
              setTimeout(function () {
                displayStats(itemType, access);
                deferred.resolve();
              }, 500);
            }));
          }));
        }), delay);
      }

      return deferred.promise;
    }

    /**
     *
     * @param itemType
     * @param access
     */
    function displayStats(itemType, access) {
      var tableNodeId = lang.replace("table.{0}.{1}", [itemType, access]);
      var stats = {
        available: query('.available', tableNodeId).length,
        notavailable: query('.notavailable', tableNodeId).length
      };
      var statsNodeId = lang.replace("stats.{0}.{1}", [itemType, access]);
      dom.byId(statsNodeId).innerHTML = lang.replace("Available: {available}&nbsp;&nbsp;&nbsp;Not Available: {notavailable}", stats);

      addRefreshButton(itemType, access);
    }

    /**
     *
     * @param itemType
     * @param access
     */
    function addRefreshButton(itemType, access) {

      var refreshBtnId = lang.replace("refresh.{0}.{1}", [itemType, access]);
      var refreshBtnNode = dom.byId(refreshBtnId);
      if(!refreshBtnNode) {
        var statsNodeId = lang.replace("stats.{0}.{1}", [itemType, access]);

        var refreshButton = new Button({
          id: refreshBtnId,
          'class': 'refreshBtn',
          label: 'Status Check',
          title: lang.replace("Check status of {1} {0}", [itemType, access]),
          onClick: lang.hitch(this, function () {
            dom.byId(statsNodeId).innerHTML = '';
            var tableNodeId = lang.replace("table.{0}.{1}", [itemType, access]);
            //domConstruct.empty(tableNodeId);
            displayItemsInOrgByItemTypeAndAccess(itemType, access, 100);
          })
        }, domConstruct.create('span', {}, statsNodeId, 'before'));

      }
    }

    /**
     *
     * @param itemType
     * @param access
     * @returns {*}
     */
    function getItemsInOrgByItemTypeAndAccess(itemType, access) {
      var deferred = new Deferred();

      var statsNodeId = lang.replace("stats.{0}.{1}", [itemType, access]);
      dom.byId(statsNodeId).innerHTML = "Searching...";

      var queryParams = {
        q: lang.replace('accountid:{0} access:{1} {2}', [portalUser.portal.id, access, itemTypes[itemType]]),
        sortField: 'title',
        sortOrder: 'asc',
        start: 0,
        num: 100
      };
      searchItems(queryParams).then(lang.hitch(this, function (allResults) {
        deferred.resolve(allResults);
      }));

      return deferred.promise;
    }

    /**
     * RECURSIVELY SEARCH UNTIL ALL RESULTS ARE RETURNED
     * NOTE: THIS CALL CAN BE DANGEROUS IF THE QUERY
     * RESULT TOTAL COUNT IS VERY LARGE. USE CAUTIOUSLY.
     *
     * @param queryParams
     * @param allResults
     * @returns {*}
     */
    function searchItems(queryParams, allResults) {
      var deferred = new Deferred();

      if(!allResults) {
        allResults = [];
      }
      portalUser.portal.queryItems(queryParams).then(lang.hitch(this, function (response) {
        allResults = allResults.concat(response.results);
        if(response.nextQueryParams.start > -1) {
          searchItems(response.nextQueryParams, allResults).then(deferred.resolve, deferred.reject);
        } else {
          deferred.resolve(allResults);
        }
      }));

      return deferred.promise;
    }

    /**
     *
     * @param serviceItems
     * @param itemType
     * @param access
     * @returns {*}
     */
    function createItemsTable(serviceItems, itemType, access) {
      var deferred = new Deferred();

      var statsNodeId = lang.replace("stats.{0}.{1}", [itemType, access]);
      dom.byId(statsNodeId).innerHTML = "Checking services...";

      var tableNodeId = lang.replace("table.{0}.{1}", [itemType, access]);
      var tableNode = dom.byId(tableNodeId);
      domConstruct.empty(tableNodeId);

      var itemCheckDeferredArray = array.filter(serviceItems,function (serviceItem) {
        // WE COULD ALSO RESTICT ITEMS CHECKED HERE... //
        return true;
        // TO DEBUG PROBLEMATIC ITEMS //
        //return (array.indexOf(problematicItemIds,serviceItem.id) > -1);   //
        // TO AVOID PROBLEMATIC ITEMS //
        //return (array.indexOf(problematicItemIds,serviceItem.id) === -1); //
      }).map(function (item, itemIndex) {
            //console.log(item);

            var itemsNodeId = (tableNode.id + '.items.' + item.owner);
            var itemsNode = dom.byId(itemsNodeId);
            if(!itemsNode) {

              var ownerRow = domConstruct.create('tr', {
                id: 'owner.' + item.owner,
                class: 'ownerRow',
                access: item.access
              }, tableNode);

              var ownerNameNode = domConstruct.create('div', {
                'class': 'ownerNameNode',
                innerHTML: item.owner
              }, domConstruct.create('td', {
                'class': 'ownerNameCell'
              }, ownerRow));

              itemsNode = domConstruct.create('div', {
                'class': 'itemsNode',
                id: itemsNodeId
              }, domConstruct.create('td', {
                'class': 'itemsCell'
              }, ownerRow));
            }

            var itemNode = domConstruct.create('div', {
              id: lang.replace("{0}.item.{1}", [itemsNodeId, item.id]),
              'class': 'itemNode'
            }, itemsNode);

            var thumbNode = domConstruct.create('img', {
              id: lang.replace("{0}.thumb.{1}", [itemsNodeId, item.id]),
              'class': 'thumbNode',
              src: './images/blank.png'
            }, itemNode);
            connectMouseEvents(thumbNode, item, {message: "Checking..."});

            var checkItemAvailability = (itemType === 'services') ? checkServiceAvailability : checkWebmapAvailability;
            return checkItemAvailability(itemNode.id, item, (itemIndex * 200)).then(lang.hitch(this, function (okStatus) {

              thumbNode.src = (item.thumbnailUrl || './images/default_item.png');
              thumbNode.onload = function () {
                domClass.remove(itemNode, 'checking');
                domClass.add(itemNode, okStatus.status);
              };
              connectMouseEvents(thumbNode, item, okStatus);

            }), lang.hitch(this, function (errorStatus) {
              domClass.remove(itemNode, 'checking');
              domClass.add(itemNode, errorStatus.status);
              connectMouseEvents(thumbNode, item, errorStatus);
            }));
          });

      var itemCheckDeferredList = new DeferredList(itemCheckDeferredArray);
      itemCheckDeferredList.then(deferred.resolve, deferred.reject);

      return deferred.promise;
    }

    /**
     *
     * @param thumbNode
     * @param item
     * @param status
     */
    function connectMouseEvents(thumbNode, item, status) {
      on(thumbNode, mouse.enter, lang.hitch(this, function () {
        if(displayStatusTimeout) {
          clearTimeout(displayStatusTimeout);
        }
        displayStatusTimeout = setTimeout(lang.hitch(this, function () {
          displayItemStatus(thumbNode, item, status);
        }), 500);
      }));
      on(thumbNode, mouse.leave, lang.hitch(this, function () {
        if(displayStatusTimeout) {
          clearTimeout(displayStatusTimeout);
        }
      }));
    }

    /**
     *
     * @param itemNodeId
     * @param item
     * @param delay
     * @returns {*}
     */
    function checkServiceAvailability(itemNodeId, item, delay) {
      var deferred = new Deferred();

      if(item.type && (array.indexOf(["WMS", "KML"], item.type) > -1)) {
        //console.warn("checkServiceAvailability- Item type: ",item.type);
        deferred.resolve({
          id: (item.title || item.id),
          message: lang.replace("Can't check url: {type}", item),
          status: 'notchecked'
        });

      } else {

        if(!item.url) {
          //console.warn("checkServiceAvailability- Item missing url: ",item);
          deferred.resolve({
            id: (item.title || item.id),
            message: (item.featureCollection) ? "FeatureCollection stored in map" : "No url to check",
            status: 'storedinmap'
          });

        } else {
          setTimeout(lang.hitch(this, function () {
            if(itemNodeId) {
              domClass.add(itemNodeId, 'checking');
            }

            esriRequest({
              url: item.itemDataUrl || item.url,
              timeout: (requestTimeoutSeconds * 1000),
              content: {
                f: 'json'
              },
              callbackParamName: "callback"
            }).then(lang.hitch(this, function (response) {
                  deferred.resolve({
                    id: item.url,
                    message: "OK",
                    status: "available"
                  });
                }), lang.hitch(this, function (error) {

                  var errorMessage = error.message ? error.message : 'No Error Message Available';
                  var status = errorMessage.toLowerCase().replace(/ /g, '');
                  if(errorMessage === 'Unable to complete  operation.') {
                    status = 'unabletocompleteoperation';
                  }
                  if(errorMessage.indexOf('Unable to load') > -1) {
                    status = 'unabletoload';
                  }
                  deferred.reject({
                    id: item.url,
                    message: errorMessage,
                    status: status
                  });

                }));

          }), delay);

        }
      }

      return deferred.promise;
    }

    /**
     *
     * @param item
     * @returns {*}
     */
    function getWebmap(item) {
      var deferred = new Deferred();

      esriRequest({
        url: item.itemDataUrl,
        timeout: (requestTimeoutSeconds * 1000),
        content: {
          token: portalUser.credential.token,
          f: 'json'
        },
        callbackParamName: "callback"
      }).then(lang.hitch(this, function (response) {
            deferred.resolve({
              item: item,
              itemData: response
            });
          }), lang.hitch(this, function (error) {
            //console.warn("getWebmap: ERROR  ::: ",item.itemDataUrl,error);
            deferred.reject(error);
          }));

      return deferred.promise;
    }

    /**
     *
     * @param itemNodeId
     * @param item
     * @param delay
     * @returns {*}
     */
    function checkWebmapAvailability(itemNodeId, item, delay) {
      var deferred = new Deferred();

      setTimeout(lang.hitch(this, function () {
        if(itemNodeId) {
          domClass.add(itemNodeId, 'checking');
        }

        getWebmap(item).then(lang.hitch(this, function (itemResponse) {
          if(itemResponse.itemData.operationalLayers.length === 0) {
            deferred.reject({
              id: item.id,
              message: "No layers in this map",
              status: 'nolayers'
            });

          } else {

            var itemCheckDeferredArray = array.map(itemResponse.itemData.operationalLayers, lang.hitch(this, function (operationalLayer, operationalLayerIndex) {
              return checkServiceAvailability(null, operationalLayer, (operationalLayerIndex * 300));
            }));
            var itemCheckDeferredList = new DeferredList(itemCheckDeferredArray);
            itemCheckDeferredList.then(lang.hitch(this, function (responses) {

              // OK RESPONSES //
              var okResponses = array.filter(responses, function (response) {
                return (response[0] === true);
              });

              // AVAILABLE //
              var availableMessage = lang.replace("{0} of {1} layers available", [okResponses.length, responses.length]);

              // RESPONSES //
              var responseMessages = array.map(responses, function (response) {
                //console.warn("checkWebmapAvailability: ",response);
                return lang.replace("{id}&nbsp;&nbsp;<span class='status'>{message}</span>", response[1]);
              });

              // STATUS //
              var statusMessage = lang.replace("{0}<br/><br/>{1}", [availableMessage, responseMessages.join('<br/><br/>')]);

              // ARE ALL RESPONSES OK //
              if(okResponses.length === responses.length) {
                deferred.resolve({
                  id: item.id,
                  message: statusMessage,
                  status: 'available'
                });
              } else {
                deferred.reject({
                  id: item.id,
                  message: statusMessage,
                  status: 'notavailable'
                });
              }
            }), deferred.reject);
          }

        }), lang.hitch(this, function (error) {
          //console.warn("checkWebmapAvailability: ERROR  ::: ",item.id,error);
          deferred.reject({
            id: item.id,
            message: "getWebmap failed...",
            status: 'nowebmap'
          });
        }));

      }), delay);

      return deferred.promise;
    }

    /**
     *
     * @param node
     * @param item
     * @param status
     */
    function displayItemStatus(node, item, status) {

      var infoTable = put('table.infoTable', {width: '100%', cellPadding: 0, cellSpacing: 0});
      put(infoTable, 'tr td.cell div.info.edge');
      put(infoTable, 'tr td.cell div.info').innerHTML = lang.replace("<b>Type</b>: {type}", item);
      put(infoTable, 'tr td.cell div.info').innerHTML = lang.replace("<b>Title</b>: {title}", item);
      put(infoTable, 'tr td.cell div.info').innerHTML = lang.replace("<b>Id</b>: {id}", item);
      if(item.url) {
        put(infoTable, 'tr td.cell div.info').innerHTML = lang.replace("<b>Url</b>: {url}", item);
      }
      put(infoTable, 'tr td.cell div.info').innerHTML = lang.replace('<b>Status</b>: {message}', status);
      put(infoTable, 'tr td.cell div.info.edge');

      var closeBtnNode = put(infoTable, 'tr td center.actionNode');

      var viewItemBtn = new Button({
        label: "Details",
        title: lang.replace('View details in {portalName}', portalUser.portal),
        onClick: lang.hitch(this, function () {
          var agsDetailsUrl = lang.replace("{0}//{1}.{2}/home/item.html?id={3}", [document.location.protocol, portalUser.portal.urlKey, portalUser.portal.customBaseUrl, item.id]);
          window.open(agsDetailsUrl);
        })
      }, put(closeBtnNode, 'div'));

      var mapItemBtn = new Button({
        label: "Map",
        title: lang.replace('Open map in {portalName}', portalUser.portal),
        onClick: lang.hitch(this, function () {
          var itemType = (item.type === "Web Map") ? "webmap" : "services";
          var agsMapUrl = lang.replace("{0}//{1}.{2}/home/webmap/viewer.html?{3}={4}", [document.location.protocol, portalUser.portal.urlKey, portalUser.portal.customBaseUrl, itemType, item.id]);
          window.open(agsMapUrl);
        })
      }, put(closeBtnNode, 'div'));

      var closeBtn = new Button({
        label: "Cancel",
        title: 'Close information dialog',
        onClick: lang.hitch(this, function () {
          popup.close(infoDialog);
        })
      }, put(closeBtnNode, 'div'));

      var infoDialog = new TooltipDialog({
        content: infoTable
      });

      popup.open({
        popup: infoDialog,
        orient: ["below-centered", "above-centered", "before-centered", "after-centered"],
        around: node
      });

    }

    /**
     *
     * @param dialogMessage
     * @returns {*}
     */
    function pickPortal(dialogMessage) {
      var deferred = new Deferred();

      var selectedPortalUrl = portalUrlList[0];

      if(portalUrlList.length === 1) {
        deferred.resolve(selectedPortalUrl);
      } else {

        var portalsNode = domConstruct.create('div', {
          style: 'margin:5px',
          innerHTML: dialogMessage || "Select Portal:"
        });

        var portalList = domConstruct.create('div', {
          className: 'dijitDialogPaneContentArea',
          style: 'margin:5px;padding:5px;border:solid 1px gray;'
        }, portalsNode);

        array.forEach(portalUrlList, lang.hitch(this, function (portalUrl) {
          domConstruct.create('div', {
            className: 'portalUrlNode',
            innerHTML: portalUrl,
            click: lang.hitch(this, function () {
              selectedPortalUrl = portalUrl;
              pickPortalDialog.hide();
            })
          }, portalList);
        }));

        var pickPortalDialog = new Dialog({
          title: document.title,
          content: portalsNode,
          onHide: lang.hitch(this, function () {
            deferred.resolve(selectedPortalUrl);
          })
        });
        pickPortalDialog.show();
      }

      return deferred.promise;
    }

  });
});


