const { TabixIndexedFile } = cjsRequire('@gmod/tabix')
const VCF = cjsRequire('@gmod/vcf')

define([
           'dojo/_base/declare',
           'JBrowse/Errors',
           'dojo/_base/lang',
           'JBrowse/Store/SeqFeature',
           'JBrowse/Store/DeferredStatsMixin',
           'JBrowse/Store/DeferredFeaturesMixin',
           'JBrowse/Store/SeqFeature/IndexedStatsEstimationMixin',
           'JBrowse/Model/XHRBlob',
           'JBrowse/Model/BlobFilehandleWrapper',
           'JBrowse/Model/SimpleFeature',
           'JBrowse/Store/SeqFeature/VCF/FeatureMaker'
       ],
       function(
           declare,
           Errors,
           lang,
           SeqFeatureStore,
           DeferredStatsMixin,
           DeferredFeaturesMixin,
           IndexedStatsEstimationMixin,
           XHRBlob,
           BlobFilehandleWrapper,
           SimpleFeature,
           FeatureMaker
           ) {

return declare( [ SeqFeatureStore, DeferredStatsMixin, DeferredFeaturesMixin, IndexedStatsEstimationMixin, FeatureMaker],
{

    constructor( args ) {
        var thisB = this;
        var csiBlob, tbiBlob;

        if(args.csi || this.config.csiUrlTemplate) {
            csiBlob = args.csi ||
                new BlobFilehandleWrapper(
                    new XHRBlob(
                        this.resolveUrl(
                            this.getConf('csiUrlTemplate',[])
                        )
                    )
                );
        } else {
            tbiBlob = args.tbi ||
                new BlobFilehandleWrapper(
                    new XHRBlob(
                        this.resolveUrl(
                            this.getConf('tbiUrlTemplate',[]) || this.getConf('urlTemplate',[])+'.tbi'
                        )
                    )
                );
        }

        var fileBlob = args.file ||
            new BlobFilehandleWrapper(
                new XHRBlob(
                    this.resolveUrl( this.getConf('urlTemplate',[]) ),
                    { expectRanges: true }
                )
            );

        this.fileBlob = fileBlob

        this.indexedData = new TabixIndexedFile({
            tbiFilehandle: tbiBlob,
            csiFilehandle: csiBlob,
            filehandle: fileBlob,
            chunkSizeLimit: args.chunkSizeLimit || 1000000,
            renameRefSeqs: n => this.browser.regularizeReferenceName(n)
        });

        this.indexedData.featureCount = ref => {
            const regularizeReferenceName = this.browser.regularizeReferenceName(ref)
            return this.indexedData.lineCount(regularizeReferenceName);
        };

        this.getParser()
            .then( function( parser ) {
                       thisB._deferred.features.resolve({success:true});
                       thisB._estimateGlobalStats()
                            .then(
                                function( stats ) {
                                    thisB.globalStats = stats;
                                    thisB._deferred.stats.resolve( stats );
                                },
                                lang.hitch( thisB, '_failAllDeferred' )
                            );
                   },
                   lang.hitch( thisB, '_failAllDeferred' )
                 );

        this.storeTimeout = args.storeTimeout || 3000;
    },

    getParser() {
        if (!this._parser) {
            this._parser = this.indexedData.getHeader()
            .then(header => new VCF({header: header}))
        }
        return this._parser
    },

    _getFeatures( query, featureCallback, finishedCallback, errorCallback ) {
        var thisB = this;
        thisB.getParser().then(parser => {
            const regularizeReferenceName = this.browser.regularizeReferenceName(query.ref)
            thisB.indexedData.getLines(
                regularizeReferenceName,
                query.start,
                query.end,
                line => {
                    const variant = parser.parseLine(line)
                    const protoF = this.variantToFeature(parser, variant)
                    const f = new SimpleFeature({
                        data: protoF});
                    f.parser = parser;
                    // override SimpleFeature's get()
                    f.get = function ( field ) {
                        if (field in this.data) return this.data[field]
                        else field = field.toLowerCase()
                        if (field in this.data) return this.data[field]
                        else return undefined
                    }
                    featureCallback(f)
                }
            )
            .then(finishedCallback, error => {
                if (errorCallback) {
                    if (error.message && error.message.indexOf('Too much data') >= 0) {
                        error = new Errors.DataOverflow(error.message)
                    }
                    errorCallback(error)
                } else
                    console.error(error)
            })
        })
        .catch(errorCallback)
    },

    /**
     * Interrogate whether a store has data for a given reference
     * sequence.  Calls the given callback with either true or false.
     *
     * Implemented as a binary interrogation because some stores are
     * smart enough to regularize reference sequence names, while
     * others are not.
     */
    hasRefSeq( seqName, callback, errorCallback ) {
        return this.indexedData.index.hasRefSeq( seqName, callback, errorCallback );
    },


    saveStore() {
        return {
            urlTemplate: this.config.file.url,
            tbiUrlTemplate: ((this.config.tbi)||{}).url,
            csiUrlTemplate: ((this.config.csi)||{}).url
        };
    }

});
});
