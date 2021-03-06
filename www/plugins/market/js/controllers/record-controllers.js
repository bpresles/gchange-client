angular.module('cesium.market.record.controllers', ['cesium.market.record.services', 'cesium.es.services', 'cesium.es.common.controllers'])

  .config(function($stateProvider) {
    'ngInject';

    $stateProvider

    .state('app.market_view_record', {
      url: "/market/view/:id/:title?refresh",
      views: {
        'menuContent': {
          templateUrl: "plugins/market/templates/record/view_record.html",
          controller: 'MkRecordViewCtrl'
        }
      }
    })

    .state('app.market_view_record_anchor', {
      url: "/market/view/:id/:title/:anchor?refresh",
      views: {
        'menuContent': {
          templateUrl: "plugins/market/templates/record/view_record.html",
          controller: 'MkRecordViewCtrl'
        }
      }
    })

    .state('app.market_add_record', {
      cache: false,
      url: "/market/add/:type",
      views: {
        'menuContent': {
          templateUrl: "plugins/market/templates/record/edit_record.html",
          controller: 'MkRecordEditCtrl'
        }
      }
    })

    .state('app.market_edit_record', {
      cache: false,
      url: "/market/edit/:id/:title",
      views: {
        'menuContent': {
          templateUrl: "plugins/market/templates/record/edit_record.html",
          controller: 'MkRecordEditCtrl'
        }
      }
    });
  })

 .controller('MkRecordViewCtrl', MkRecordViewController)

 .controller('MkRecordEditCtrl', MkRecordEditController)

 .controller('MkRecordPaymentModalCtrl', MkRecordPaymentModalController)

;


function MkRecordViewController($scope, $rootScope, $anchorScroll, $ionicPopover, $state, $ionicHistory, $q, $controller,
                                $timeout, $filter, $translate, UIUtils, ModalUtils,
                                csCrypto, csConfig, csSettings, csCurrency, csWallet,
                                esModals, esProfile, esHttp,
                                mkRecord, mkTx) {
  'ngInject';


  $scope.formData = {};
  $scope.id = null;
  $scope.category = {};
  $scope.pictures = [];
  $scope.canEdit = false;
  $scope.maxCommentSize = 10;
  $scope.loading = true;
  $scope.motion = UIUtils.motion.fadeSlideInRight;
  $scope.smallscreen = UIUtils.screen.isSmall();
  $scope.moreAdMotion = UIUtils.motion.default;
  $scope.smallpictures = false;

  // Screen options
  $scope.options = $scope.options || angular.merge({
    type: {
      show: true
    },
    category: {
      show: true
    },
    location: {
      show: true,
      prefix : undefined
    },
    like: {
      kinds: ['VIEW', 'LIKE', 'FOLLOW', 'ABUSE'],
      index: 'market',
      type: 'record',
      service: mkRecord.record.like
    }
  }, csConfig.plugins && csConfig.plugins.market && csConfig.plugins.market.record || {});

  $scope.likeData = {
    views: {},
    likes: {},
    follows: {},
    abuses: {}
  };
  $scope.search = {
    type: null,
    results: [],
    total: 0,
    loading: true
  };

  // Initialize the super class and extend it.
  angular.extend(this, $controller('ESLikesCtrl', {$scope: $scope}));

  $scope.enter = function (e, state) {
    if (state.stateParams && state.stateParams.id) { // Load by id
      if ($scope.loading || state.stateParams.refresh) {
        $scope.load(state.stateParams.id);
      }
      else {
        // prevent reload if same id (and if not forced)
        UIUtils.loading.hide();
        $scope.updateButtons();
        $scope.updatePaymentData();
      }

      // Notify child controllers
      $scope.$broadcast('$recordView.enter', state);
    }
    else {
      $state.go('app.market_lookup');
    }
  };
  $scope.$on('$ionicView.enter', $scope.enter);

  $scope.$on('$ionicView.beforeLeave', function (event, args) {
    $scope.$broadcast('$recordView.beforeLeave', args);
  });

  $scope.refresh = function () {
    if ($scope.loading || !$scope.formData.id) return $q.when(); // Skip
    return $scope.load($scope.formData.id);
  };

  $scope.load = function (id) {
    id = id || $scope.formData.id;
    $scope.loading = true;
    $scope.formData = {};
    var promise = mkRecord.record.load(id, {
      fetchPictures: false,// lazy load for pictures
      convertPrice: true, // convert to user unit
      html: true // convert into HTML (title, description: tags, <br/> ...)
    })
      .then(function (data) {
        $scope.formData = data.record;
        $scope.formData.feesCurrency = data.record.feesCurrency || data.record.currency;
        delete $scope.formData.useRelative;
        $scope.id = data.id;
        $scope.issuer = data.issuer;

        // Load issuer stars
        $scope.loadIssuerStars($scope.issuer.issuer);

        // Load more ads (if not mobile)
        if (!$scope.smallscreen) {
          $scope.loadMoreLikeThis(data);
        }
        $scope.loading = false;

        $scope.updateView();
        UIUtils.loading.hide(10);
      })
      .catch(function (err) {
        if (!$scope.secondTry) {
          $scope.secondTry = true;
          $timeout(function () {
            $scope.load(id); // loop once
          }, 100);
        }
        else {
          $scope.loading = false;
          UIUtils.loading.hide();
          if (err && err.ucode === 404) {
            UIUtils.toast.show('MARKET.ERROR.RECORD_NOT_EXISTS');
            $state.go('app.market_lookup');
          }
          else {
            UIUtils.onError('MARKET.ERROR.LOAD_RECORD_FAILED')(err);
          }
        }
      });

    // Continue loading other data
    $timeout(function () {

      // Load pictures
      $scope.loadPictures(id);

      // Load other data (e.g. comments - see child controller)
      $scope.$broadcast('$recordView.load', id, mkRecord.record);


    });

    return promise;
  };


  $scope.loadPictures = function(id) {
    id = id || $scope.id;
    return mkRecord.record.picture.all({id: id})
        .then(function (hit) {
          if (hit._source.pictures) {
            $scope.pictures = hit._source.pictures.reduce(function (res, pic) {
              return res.concat(esHttp.image.fromAttachment(pic.file));
            }, []);

            if ($scope.pictures.length) {
              // Set Motion
              $scope.motion.show({
                selector: '.lazy-load .item.card-gallery',
                ink: false
              });
            }
          }
        })
        .catch(function () {
          $scope.pictures = [];
        });
  };

  $scope.loadMoreLikeThis = function(data) {
    // Load more like this
    return mkRecord.record.moreLikeThis(data.id, {
      category: data.record.category.id,
      type: data.record.type,
      city: data.record.city
    })
      .then(function(res) {
        if (!res || !res.total) return; // skip
        $scope.search.results = res.hits;
        $scope.search.total = res.total;
        $scope.search.loading = false;

        $scope.motion.show({
          selector: '.list.list-more-record .item',
          ink: true
        });

      });
  };

  // Load issuer stars
  $scope.loadIssuerStars = function(pubkey) {
    if (this.canEdit || csWallet.isLogin() && csWallet.isUserPubkey(pubkey)) return; // Skip

    esProfile.like.count(pubkey, {kind: 'star', issuer: csWallet.isLogin() ? csWallet.data.pubkey : undefined})
      .then(function(stars) {
        $scope.issuer.stars = stars;
      });
  };

  $scope.updateView = function() {
    $scope.updateButtons();
    $scope.updatePaymentData();

    // Set Motion (only direct children, to exclude .lazy-load children)
    $scope.motion.show({
      selector: '.list > .item',
      ink: true
    });

    if (!$scope.canEdit) {
      $scope.showFab('fab-like-market-record-' + $scope.id);
    }
  };

  $scope.updateButtons = function() {
    $scope.canEdit = $scope.formData && csWallet.isUserPubkey($scope.formData.issuer);
    $scope.canSold = $scope.canEdit && $scope.formData.stock > 0;
    $scope.canReopen = $scope.canEdit && $scope.formData.stock === 0;
    if ($scope.canReopen) {
      $scope.canEdit = false;
    }

  };

  $scope.markAsView = function() {
    if (!$scope.likeData || !$scope.likeData.views || $scope.likeData.views.wasHit) return; // Already view
    var canEdit = $scope.canEdit || csWallet.isUserPubkey($scope.formData.issuer);
    if (canEdit) return; // User is the record's issuer: skip

    var timer = $timeout(function() {
      if (csWallet.isLogin()) {
        $scope.options.like.service.add($scope.id, {kind: 'view'}).then(function() {
          $scope.likeData.views.total = ($scope.likeData.views.total||0) + 1;
        });
      }
      timer = null;
    }, 3000);

    $scope.$on("$destroy", function() {
      if (timer) $timeout.cancel(timer);
    });
  };


  $scope.refreshConvertedPrice = function () {
    $scope.loading = true; // force reloading if settings changed (e.g. unit price)
  };
  $scope.$watch('$root.settings.useRelative', $scope.refreshConvertedPrice, true);

  $scope.edit = function () {
    $state.go('app.market_edit_record', {id: $scope.id, title: $filter('formatSlug')($scope.formData.title)});
    $scope.loading = true;
  };

  $scope.delete = function () {
    $scope.hideActionsPopover();

    UIUtils.alert.confirm('MARKET.VIEW.REMOVE_CONFIRMATION')
      .then(function (confirm) {
        if (confirm) {
          mkRecord.record.remove($scope.id)
            .then(function () {
              $ionicHistory.nextViewOptions({
                historyRoot: true
              });
              $state.go('app.market_lookup');
              UIUtils.toast.show('MARKET.INFO.RECORD_REMOVED');
            })
            .catch(UIUtils.onError('MARKET.ERROR.REMOVE_RECORD_FAILED'));
        }
      });
  };

  $scope.sold = function () {
    $scope.hideActionsPopover();

    UIUtils.alert.confirm('MARKET.VIEW.SOLD_CONFIRMATION')
        .then(function (confirm) {
          if (confirm) {
            UIUtils.loading.show();
            return mkRecord.record.setStock($scope.id, 0)
              .then(function () {
                // Update some fields (if view still in cache)
                $scope.canSold = false;
                $scope.canReopen = true;
                $scope.canEdit = false;
              })
              .catch(UIUtils.onError('MARKET.ERROR.SOLD_RECORD_FAILED'))
              .then(function() {
                $ionicHistory.nextViewOptions({
                  disableBack: true,
                  disableAnimate: false,
                  historyRoot: true
                });
                $timeout(function(){
                  UIUtils.toast.show('MARKET.INFO.RECORD_SOLD');
                }, 500);
                $state.go('app.market_lookup');
              });
          }
        });
  };

  $scope.reopen = function () {
    $scope.hideActionsPopover();

    UIUtils.alert.confirm('MARKET.VIEW.REOPEN_CONFIRMATION')
        .then(function (confirm) {
          if (confirm) {
            return UIUtils.loading.show()
                .then(function() {
                  return mkRecord.record.setStock($scope.id, 1)
                      .then(function () {
                        // Update some fields (if view still in cache)
                        $scope.canSold = true;
                        $scope.canReopen = false;
                        $scope.canEdit = true;
                        return UIUtils.loading.hide();
                      })
                      .then(function() {
                        UIUtils.toast.show('MARKET.INFO.RECORD_REOPEN');
                      })
                      .catch(UIUtils.onError('MARKET.ERROR.REOPEN_RECORD_FAILED'));
                });
          }
        });
  };

  /* -- modals & popover -- */

  $scope.showActionsPopover = function (event) {
    UIUtils.popover.show(event, {
      templateUrl: 'plugins/market/templates/record/view_popover_actions.html',
      scope: $scope,
      autoremove: true,
      afterShow: function(popover) {
        $scope.actionsPopover = popover;
      }
    });
  };

  $scope.hideActionsPopover = function () {
    if ($scope.actionsPopover) {
      $scope.actionsPopover.hide();
      $scope.actionsPopover = null;
    }
    return true;
  };

  $scope.showSharePopover = function(event) {
    $scope.hideActionsPopover();
    if ($scope.loading || !$scope.formData.title) return; // Skip if not loaded

    var title = $scope.formData.title;

    // Add price to title
    if ($scope.formData.price && $scope.formData.currency) {
      title += " | {0} {1}".format($scope.formData.price / 100, $filter('abbreviate')($scope.formData.currency));
    }

    // Use pod share URL - see issue #69
    var url = esHttp.getUrl('/market/record/' + $scope.id + '/_share');

    // Compute hashtags
    var hashtags = ($scope.formData.tags && $scope.formData.tags.slice() || []).join(' #');
    hashtags = hashtags.length ? ('#' + hashtags + ' ') : '';
    if (csSettings.data.share.defaultHastags) {
      hashtags += csSettings.data.share.defaultHastags;
    }

    // Override default position, is small screen - fix #25
    if (UIUtils.screen.isSmall()) {
      event = angular.element(document.querySelector('#record-share-anchor-' + $scope.id)) || event;
    }

    UIUtils.popover.share(event, {

      bindings: {
        url: url,
        titleKey: 'MARKET.VIEW.POPOVER_SHARE_TITLE',
        titleValues: {title: title},
        time: $scope.formData.time,
        postMessage: title,
        postImage: $scope.pictures.length > 0 ? $scope.pictures[0] : null,
        postHashtags: hashtags
      }
    });
  };

  $scope.showNewMessageModal = function() {
    return $q.all([
        $translate('MARKET.VIEW.NEW_MESSAGE_TITLE', $scope.formData),
        $scope.loadWallet({minData: true})
      ])
      .then(function(res) {
        var title = res[0];
        UIUtils.loading.hide();
        return esModals.showMessageCompose({
          title: title,
          destPub: $scope.issuer.pubkey,
          destUid: $scope.issuer.name
        });
      })
      .then(function(send) {
        if (send) UIUtils.toast.show('MESSAGE.INFO.MESSAGE_SENT');
      });
  };

  $scope.showRecord = function(event, index) {
    if (event.defaultPrevented) return;
    var item = $scope.search.results[index];
    if (item) {
      $state.go('app.market_view_record', {
        id: item.id,
        title: item.title
      });
    }
  };


  $scope.updatePaymentData = function() {
    var record = $scope.formData;
    var canPay = record && record.stock > 0;
    if (!canPay) {
      $scope.canPay = false;
      return;
    }

    // Compute TX amount
    var amount = record.price;
    var comment;
    var pubkey = record.pubkey || $scope.issuer.pubkey;

    // crowdfunding
    if (record.type === 'crowdfunding') {
      amount = undefined;
      comment = mkTx.record.computePrefix(record);
      // If present, use the record pubkey
      pubkey = record.pubkey || pubkey;
    }

    // Auction
    else if (record.type === 'auction') {
      //amount = $scope.formData.tx.max
      comment = mkTx.record.computePrefix(record);
    }

    if (!pubkey) {
      console.warn('[market] [record] No pubkey found in the issuer profile or in the Ad');
      $scope.showPayment = false;
      $scope.paymentData = null;
      return;
    }
    var pkChecksum = csCrypto.util.pkChecksum(pubkey);

    $scope.paymentData = {
        pubkey: pubkey,
        pubkeyWithChecksum: pubkey + ':' + pkChecksum,
        amount: amount,
        comment: comment,
        currency: record.currency,
      };

    // Compute URI
    mkTx.uri.compute($scope.paymentData)
      .then(function(uris) {
        $scope.paymentData.uris = uris;
      });

    $scope.showPayment = true;
  };

  $scope.showPaymentModal = function() {
    if (!$scope.showPayment || !$scope.paymentData) return;
    return ModalUtils.show('plugins/market/templates/record/modal_payment.html', 'MkRecordPaymentModalCtrl',
      $scope.paymentData);
  };

  $scope.showIssuers = function(event) {
    var comment = $scope.paymentData.comment;
    if (!comment) return; // Skip
    return $scope.openLink(event, 'https://demo.cesium.app/#/app/data/search/g1/movement?q=comment:\"'+comment+'\"');
  };

  /* -- context aware-- */

  // When wallet login/logout -> update buttons
  function onWalletChange(data, deferred) {
    deferred = deferred || $q.defer();
    $scope.updateButtons();
    $scope.loadLikes();
    deferred.resolve();
    return deferred.promise;
  }
  csWallet.api.data.on.login($scope, onWalletChange, this);
  csWallet.api.data.on.logout($scope, onWalletChange, this);
}

function MkRecordEditController($scope, $rootScope, $q, $state, $ionicPopover, $timeout, mkRecord, $ionicHistory, $focus, $controller,
                                      UIUtils, ModalUtils, BMA, csConfig, esHttp, csSettings, csCurrency, mkSettings) {
  'ngInject';

  // Screen options
  $scope.options = $scope.options || angular.merge({
        recordType: {
          show: true,
          canEdit: true
        },
        category: {
          show: true,
          filter: undefined
        },
        description: {
          show: true
        },
        location: {
          show: true,
          required: true
        },
        position: {
          showCheckbox: true,
          required: true,
          warningMessage: 'MARKET.EDIT.WARNING.NO_GEO_POINT'
        },
        unit: {
          canEdit: true
        },
        login: {
          type: "full"
        }
      }, csConfig.plugins && csConfig.plugins.market && csConfig.plugins.market.record || {});



  // Initialize the super class and extend it.
  angular.extend(this, $controller('ESPositionEditCtrl', {$scope: $scope}));

  $scope.formData = {
    type: null,
    price: null,
    category: {},
    geoPoint: null,
    useRelative: csSettings.data.useRelative,
    pubkey: null
  };
  $scope.id = null;
  $scope.pictures = [];
  $scope.loading = true;

  //console.debug("[market] Screen options: ", $scope.options);

  $scope.pubkeyPattern = BMA.regexp.PUBKEY;
  $scope.motion = UIUtils.motion.ripple;

  $scope.setForm =  function(form) {
    $scope.form = form;
  };

  $scope.enter = function(e, state) {

    return $q.all([
      mkSettings.currencies(),
      // Load wallet
      $scope.loadWallet({
        minData: true
      })
    ])
    .then(function(res) {
      $scope.currencies = res[0];
      var walletData = res[1];

      if (state.stateParams && state.stateParams.id) { // Load by id
        return $scope.load(state.stateParams.id);
      }
      else {
        // New record
        if (state.stateParams && state.stateParams.type) {
          $scope.formData.type = state.stateParams.type;
        }
        $scope.formData.type = $scope.formData.type || ($scope.options.type && $scope.options.type.default) || 'offer'; // default: offer
        $scope.formData.currency = $scope.currencies && $scope.currencies[0]; // use the first one, if any

        // Use profile
        if (walletData.profile) {
          // Set the pubkey, using the profile pubkey (if any)
          if ($scope.formData.type === 'crowdfunding' && walletData.profile.pubkey) {
            $scope.formData.pubkey = walletData.profile.pubkey;
          }

          // Fill city and address
          if (walletData.profile.city) {
            $scope.formData.address = walletData.profile.address;
            $scope.formData.city = walletData.profile.city;
            if (walletData.profile.geoPoint && walletData.profile.geoPoint.lat && walletData.profile.geoPoint.lon) {
              $scope.formData.geoPoint = walletData.profile.geoPoint;
            }
          }
        }
      }
    })
    .then(function() {

      $scope.loading = false;
      UIUtils.loading.hide();
      $scope.motion.show();

      // Focus on title
      if ($scope.options.focus && !UIUtils.screen.isSmall()) {
        $focus('market-record-title');
      }
    })
    .catch(function(err){
      if (err === 'CANCELLED') {
        $scope.motion.hide();
        $scope.showHome();
      }
      else {
        console.error(err);
      }
    });
  };
  $scope.$on('$ionicView.enter', $scope.enter);

  $scope.onFreePriceChanged = function() {
    if ($scope.formData.freePrice) {
      // Clean price
      $scope.formData.price = null;
    }
  };

  /* -- popover -- */

  $scope.showUnitPopover = function($event) {
    UIUtils.popover.show($event, {
      templateUrl: 'templates/wallet/popover_unit.html',
      scope: $scope,
      autoremove: true
    })
    .then(function(useRelative) {
      $scope.formData.useRelative = useRelative;
    });
  };

  $scope.cancel = function() {
    $scope.closeModal();
  };

  $scope.load = function(id) {

    UIUtils.loading.show();

    return mkRecord.record.load(id, {
        fetchPictures: true,
        convertPrice: false // keep original price
      })
      .then(function(data) {
        angular.merge($scope.formData, data.record);
        $scope.formData.useRelative = (data.record.unit === 'UD');
        if (!$scope.formData.useRelative) {
          // add 2 decimals in quantitative mode
          $scope.formData.price = $scope.formData.price ? $scope.formData.price / 100 : undefined;
          $scope.formData.fees = $scope.formData.fees ? $scope.formData.fees / 100 : undefined;
        }
        // Set default currency (need by HELP texts)
        if (!$scope.formData.currency) {
          $scope.formData.currency = $scope.currency;
        }

        // Convert old record format
        if (!$scope.formData.city && $scope.formData.location) {
          $scope.formData.city = $scope.formData.location;
        }
        if ($scope.formData.location) {
          $scope.formData.location = null;
        }

        $scope.id = data.id;
        $scope.pictures = data.record.pictures || [];
        delete $scope.formData.pictures; // duplicated with $scope.pictures
        $scope.dirty = false;

        $scope.motion.show({
          selector: '.animate-ripple .item, .card-gallery'
        });
        UIUtils.loading.hide();

        // Update loading - done with a delay, to avoid trigger onFormDataChanged()
        $timeout(function() {
          $scope.loading = false;
        }, 1000);

      })
      .catch(UIUtils.onError('MARKET.ERROR.LOAD_RECORD_FAILED'));
  };

  $scope.save = function(silent, hasWaitDebounce) {
    $scope.form.$submitted=true;
    if($scope.saving || // avoid multiple save
       !$scope.form.$valid || !$scope.formData.category.id) {
      return $q.reject();
    }

    if (!hasWaitDebounce) {
      console.debug('[ES] [market] Waiting debounce end, before saving...');
      return $timeout(function() {
        return $scope.save(silent, true);
      }, 650);
    }

    $scope.saving = true;
    console.debug('[ES] [market] Saving record...');

    return UIUtils.loading.show({delay: 0})
      // Preparing json (pictures + resizing thumbnail)
      .then(function() {
        var json = angular.copy($scope.formData);
        delete json.useRelative;

        var unit = $scope.formData.useRelative ? 'UD' : 'unit';

        // prepare price
        if (angular.isDefined(json.price) && json.price != null) { // warn: could be =0
          if (typeof json.price == "string") {
            json.price = parseFloat(json.price.replace(new RegExp('[.,]'), '.')); // fix #124
          }
          json.unit = unit;
          if (unit === 'unit') {
            json.price = json.price * 100;
          }
          if (!json.currency) {
            json.currency = $scope.currency;
          }
        }
        else {
          // do not use 'undefined', but 'null' - fix #26
          json.unit = null;
          json.price = null;
          // for now, allow set the currency, to make sure search request get Ad without price
          if (!json.currency) {
            json.currency = $scope.currency;
          }
        }

        // prepare fees
        if (json.fees) {
          if (typeof json.fees == "string") {
            json.fees = parseFloat(json.fees.replace(new RegExp('[.,]'), '.')); // fix #124
          }
          if (unit === 'unit') {
            json.fees = json.fees * 100;
          }
          if (!json.feesCurrency) {
            json.feesCurrency = json.currency || $scope.currency;
          }
          json.unit = json.unit || unit; // force unit to be set
        }
        else {
          // do not use 'undefined', but 'null' - fix #26
          json.fees = null;
          json.feesCurrency = null;
        }

        json.time = esHttp.date.now();

        // geo point
        if (json.geoPoint && json.geoPoint.lat && json.geoPoint.lon) {
          json.geoPoint.lat =  parseFloat(json.geoPoint.lat);
          json.geoPoint.lon =  parseFloat(json.geoPoint.lon);
        }
        else{
          json.geoPoint = null;
        }

        // Location is deprecated: force to null
        if (angular.isDefined(json.location)) {
          json.location = null;
        }

        json.picturesCount = $scope.pictures.length;
        if (json.picturesCount) {

          // Resize thumbnail
          return UIUtils.image.resizeSrc($scope.pictures[0].src, true)
            .then(function(thumbnailSrc) {
              // First image = the thumbnail
              json.thumbnail = esHttp.image.toAttachment({src: thumbnailSrc});
              // Then = all pictures
              json.pictures = $scope.pictures.reduce(function(res, picture) {
                return res.concat({
                  file: esHttp.image.toAttachment({src: picture.src})
                });
              }, []);

              return json;
            });
        }
        else {
          if ($scope.formData.thumbnail) {
            // Workaround to allow content deletion, because of a bug in the ES attachment-mapper:
            // get error (in ES node) : MapperParsingException[No content is provided.] - AttachmentMapper.parse(AttachmentMapper.java:471
            json.thumbnail = {
              _content: '',
              _content_type: ''
            };
          }
          json.pictures = [];
          return json;
        }
      })

      // Send data (create or update)
      .then(function(json) {
        if (!$scope.id) {
          json.creationTime = esHttp.date.now();

          // By default: stock always > 1 when created
          json.stock = angular.isDefined(json.stock) ? json.stock : 1;

          return mkRecord.record.add(json);
        }
        else {
          return mkRecord.record.update(json, {id: $scope.id});
        }
      })

      // Redirect to record view
      .then(function(id) {
        var isNew = !$scope.id;
        $scope.id = $scope.id || id;
        $scope.saving = false;
        $scope.dirty = false;

        // Has back history: go back then reload the view record page
        if (!!$ionicHistory.backView()) {
          var offState = $rootScope.$on('$stateChangeSuccess',
            function(event, toState, toParams, fromState, fromParams){
              event.preventDefault();
              $state.go('app.market_view_record', {id: $scope.id}, {location: "replace", reload: true});
              offState(); // remove added listener
            });
          $ionicHistory.goBack(isNew ? -1 : -2);
        }
        // No back view: can occur when reloading the edit page
        else {
          $ionicHistory.nextViewOptions({
            historyRoot: true
          });
          $state.go('app.market_view_record', {id: $scope.id});
        }
      })

      .catch(function(err) {
        $scope.saving = false;

        // Replace with a specific message
        if (err && err.message === 'ES_HTTP.ERROR.MAX_UPLOAD_BODY_SIZE') {
          err.message = 'MARKET.ERROR.RECORD_EXCEED_UPLOAD_SIZE';
        }

        UIUtils.onError('MARKET.ERROR.FAILED_SAVE_RECORD')(err);
      });
  };

  $scope.openCurrencyLookup = function() {
    alert('Not implemented yet. Please submit an issue if occur again.');
  };

  $scope.cancel = function() {
    $scope.dirty = false; // force not saved
    $ionicHistory.goBack();
  };

  $scope.$on('$stateChangeStart', function (event, next, nextParams, fromState) {
    if (!$scope.dirty || $scope.saving || event.defaultPrevented) return;

    // stop the change state action
    event.preventDefault();

    if ($scope.loading) return;

    return UIUtils.alert.confirm('CONFIRM.SAVE_BEFORE_LEAVE',
      'CONFIRM.SAVE_BEFORE_LEAVE_TITLE', {
        cancelText: 'COMMON.BTN_NO',
        okText: 'COMMON.BTN_YES_SAVE'
      })
      .then(function(confirmSave) {
        if (confirmSave) {
          return $scope.save();
        }
      })
      .then(function() {
        $scope.dirty = false;
        $ionicHistory.nextViewOptions({
          historyRoot: true
        });
        $state.go(next.name, nextParams);
        UIUtils.loading.hide();
      });
  });

  $scope.onFormDataChanged = function() {
    if ($scope.loading) return;
    $scope.dirty = true;
  };
  $scope.$watch('formData', $scope.onFormDataChanged, true);

  /* -- modals -- */

  $scope.showRecordTypeModal = function() {
    ModalUtils.show('plugins/market/templates/record/modal_record_type.html')
    .then(function(type){
      if (type) {
        $scope.formData.type = type;
      }
    });
  };

  $scope.showCategoryModal = function() {
    // load categories
    var getCategories;
    if ($scope.options && $scope.options.category && $scope.options.category.filter) {
      getCategories = mkRecord.category.filtered({filter: $scope.options.category.filter});
    }
    else {
      getCategories = mkRecord.category.all();
    }

    getCategories
      .then(function(categories){
        return ModalUtils.show('plugins/es/templates/common/modal_category.html', 'ESCategoryModalCtrl as ctrl',
          {categories : categories},
          {focusFirstInput: true}
        );
      })
      .then(function(cat){
        if (cat && cat.parent) {
          $scope.formData.category = cat;
        }
      });
  };
}

function MkRecordPaymentModalController($scope, parameters, csSettings, mkTx) {

  $scope.loading = true;
  $scope.formData = {
    helpSiteUrl: csSettings.data.userForumUrl
  };

  $scope.openHelpSite = function(event) {
    return $scope.openLink(event, csSettings.data.userForumUrl || 'https://forum.monnaie-libre.fr');
  };

  $scope.load = function() {

    console.debug("[market] Display payment info", parameters);

    angular.merge($scope.formData, parameters);

    return mkTx.uri.compute(parameters)
      .then(function(links) {
        $scope.links = links;
        $scope.loading = false;
    });

  };

  $scope.load();
}
