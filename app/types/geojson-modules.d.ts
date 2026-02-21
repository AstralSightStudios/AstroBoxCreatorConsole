declare module "geojson-world-map" {
    const worldMapGeoJson: {
        type: "FeatureCollection";
        features: any[];
        [key: string]: any;
    };

    export default worldMapGeoJson;
}

declare module "china-map-geojson" {
    const chinaMapGeoJson: {
        ChinaData: {
            type: "FeatureCollection";
            features: any[];
            [key: string]: any;
        };
        ProvinceData: Record<string, any>;
        [key: string]: any;
    };

    export default chinaMapGeoJson;
}
