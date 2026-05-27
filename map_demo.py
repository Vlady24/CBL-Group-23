import pandas as pd
import geopandas as gpd
import folium

# load clustered lsoa features
cl = pd.read_csv("algorithms_for_solution/lsoa_features_with_clusters.csv")

cluster_names = {0: "Low-demand, volatile", 1: "High-demand / shoplifting areas",
                 2: "Medium-demand / violence-dominant areas", 3: "Medium-high / ASB-heavy demand"}

cluster_colors = {0: "#4A90A4", 1: "#D64550", 2: "#F29E4C",3: "#F2C94C"}

# manually reconstruct patrol route outputted by routing algorithm (only for demo)
route_fr = [
    {"route_order": 0, "lsoa_name": "Birmingham Central HQ Depot", "severity_score": None, "node_type": "Depot"},
    {"route_order": 1, "lsoa_name": "Birmingham 138A", "severity_score": 89552, "node_type": "Patrol target"},
    {"route_order": 2, "lsoa_name": "Birmingham 050E", "severity_score": 26440, "node_type": "Patrol target"},
    {"route_order": 3, "lsoa_name": "Birmingham 050F", "severity_score": 30660, "node_type": "Patrol target"},
    {"route_order": 4, "lsoa_name": "Birmingham 135C", "severity_score": 36573, "node_type": "Patrol target"},
    {"route_order": 5, "lsoa_name": "Birmingham 136B", "severity_score": 22115, "node_type": "Patrol target"},
    {"route_order": 6, "lsoa_name": "Birmingham 134B", "severity_score": 20586, "node_type": "Patrol target"},
    {"route_order": 7, "lsoa_name": "Birmingham 087F", "severity_score": 17099, "node_type": "Patrol target"},
    {"route_order": 8, "lsoa_name": "Birmingham 033F", "severity_score": 22999, "node_type": "Patrol target"},
    {"route_order": 9, "lsoa_name": "Walsall 030A", "severity_score": 35823, "node_type": "Patrol target"},
    {"route_order": 10, "lsoa_name": "Wolverhampton 020H", "severity_score": 30374, "node_type": "Patrol target"},
    {"route_order": 11, "lsoa_name": "Wolverhampton 020G", "severity_score": 17910, "node_type": "Patrol target"},
    {"route_order": 12, "lsoa_name": "Solihull 009A", "severity_score": 18043, "node_type": "Patrol target"},
    {"route_order": 13, "lsoa_name": "Coventry 031F", "severity_score": 29247, "node_type": "Patrol target"},
    {"route_order": 14, "lsoa_name": "Coventry 031E", "severity_score": 31565, "node_type": "Patrol target"},
    {"route_order": 15, "lsoa_name": "Coventry 019A", "severity_score": 16862, "node_type": "Patrol target"},
    {"route_order": 16, "lsoa_name": "Birmingham Central HQ Depot", "severity_score": None, "node_type": "Depot"}]

route_df = pd.DataFrame(route_fr)

# load lsoa boundaries 
boundaries = gpd.read_file("other_data/LSOA_boundaries.geojson")

boundaries = boundaries.rename(columns={"LSOA21CD": "lsoa_code",
    "LSOA21NM": "boundary_lsoa_name"})

# convert boundares to wgs84 for folium web mapping
boundaries_4326 = boundaries.to_crs(epsg=4326)

# get lsoa centroids to put patrol stops on map
centroids = boundaries_4326.copy()
centroids_projected = centroids.to_crs(epsg=27700)
centroids_projected["geometry"] = centroids_projected.geometry.centroid
centroids = centroids_projected.to_crs(epsg=4326)

centroids["lat"] = centroids.geometry.y
centroids["lng"] = centroids.geometry.x

centroid_lookup = centroids[["boundary_lsoa_name", "lsoa_code", "lat", "lng"]].copy()

# match route stops to lsoa centroid coordinates
route_df = route_df.merge(centroid_lookup,left_on="lsoa_name", right_on="boundary_lsoa_name", how="left")

depot_lat = 52.4831
depot_lng = -1.8966

route_df.loc[route_df["node_type"] == "Depot", "lat"] = depot_lat
route_df.loc[route_df["node_type"] == "Depot", "lng"] = depot_lng
route_df.loc[route_df["node_type"] == "Depot", "lsoa_code"] = None
route_df.loc[route_df["node_type"] == "Depot", "boundary_lsoa_name"] = "Birmingham Central HQ Depot"

missing = route_df[route_df["lat"].isna() | route_df["lng"].isna()]

if len(missing) > 0:
    print("Warning: these route points were not matched to LSOA boundaries:")
    print(missing[["route_order", "lsoa_name"]])
else:
    print("All route points matched successfully.")

# save route table
route_df.to_csv("visualizations/west_midlands_route.csv", index=False)


# select cluster features to show on map
map_cols = ["lsoa_code", "lsoa_name","cluster",
    "monthly_mean_rate_per_1000", "log_monthly_mean_rate_per_1000",
    "coefficient_of_variation_capped", "violence_share", "asb_share",
    "burglary_share", "shoplifting_share","vehicle_crime_share"]

# only select those areas where West Midlands Police operates
west_midlands_areas = ["Birmingham", "Coventry", "Dudley", "Sandwell","Solihull", "Walsall","Wolverhampton"]

area_prefixes = tuple(area + " " for area in west_midlands_areas)

west_midlands_boundaries = boundaries[boundaries["boundary_lsoa_name"].str.startswith(area_prefixes, na=False)].copy()

# combine West Midlands boundaries with clusters
map_df = west_midlands_boundaries.merge(cl[map_cols], on="lsoa_code", how="left")

map_df["police_area"] = "West Midlands Police area"

print("West Midlands area:")
print("lsoas num:", west_midlands_boundaries["lsoa_code"].nunique())

map_df = gpd.GeoDataFrame(map_df, geometry="geometry", crs=boundaries.crs)
map_df = map_df.to_crs(epsg=4326)
map_df["cluster_name"] = map_df["cluster"].map(cluster_names)
map_df["cluster_name"] = map_df["cluster_name"].fillna("No cluster / excluded sparse LSOA")

center_lat = route_df["lat"].mean()
center_lon = route_df["lng"].mean()

def style_fun(feature):
    c = feature["properties"]["cluster"]
    if pd.isna(c):
        fill = "#E5E7EB"
    else:
        fill = cluster_colors.get(int(c), "#E5E7EB")
    return {"fillColor": fill, "color": "#FFFFFF", "weight": 0.35, "fillOpacity": 0.72}

# create folium map
m = folium.Map(location=[center_lat, center_lon], zoom_start = 10, tiles = "cartodbpositron")

folium.GeoJson(map_df, style_function = style_fun,
    tooltip = folium.GeoJsonTooltip(
        fields=["police_area", "lsoa_code", "boundary_lsoa_name", "lsoa_name",
            "cluster_name", "monthly_mean_rate_per_1000", "coefficient_of_variation_capped",
            "violence_share", "asb_share", "shoplifting_share"
            ],
        aliases=["Police area:", "LSOA code:", "Boundary name:","Crime-table name:",
            "Cluster:", "Monthly mean rate / 1000:", "Volatility:",
            "Violence share:", "ASB share:", "Shoplifting share:"
        ],
        localize=True,
        sticky=True,
        style="""
            background-color: rgba(255, 255, 255, 0.96);
            border: 1px solid #E5E7EB;
            border-radius: 12px;
            box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
            color: #111827;
            font-family: 'Inter', Arial, sans-serif;
            font-size: 13px;
            padding: 10px 12px;
        """
    )).add_to(m)

# draw patrol route
route_df = route_df.sort_values("route_order").copy()
route_line = list(zip(route_df["lat"], route_df["lng"]))

folium.PolyLine(route_line, color="#424242", weight=5, opacity=0.9, tooltip="Recommended patrol route").add_to(m)

for _, row in route_df.iterrows():
    order = int(row["route_order"])

    if row["node_type"] == "Depot":
        marker_text = "H"
        popup_text = f"<b>Depot</b><br>{row['lsoa_name']}"
        bg = "#424242"
        color = "#FFFFFF"
        border = "#FFFFFF"
    else:
        marker_text = str(order)
        popup_text = (
            f"<b>Stop {order}</b><br>"
            f"{row['lsoa_name']}<br>"
            f"Severity score: {int(row['severity_score'])}"
        )
        bg = "#FFFFFF"
        color = "#424242"
        border = "#424242"

    folium.Marker(
        location = [row["lat"], row["lng"]],
        tooltip = f"{order}. {row['lsoa_name']}",
        popup = popup_text,
        icon = folium.DivIcon(
            html = f"""
            <div style="
                background:{bg};
                color:{color};
                border-radius:50%;
                width:30px;
                height:30px;
                text-align:center;
                line-height:30px;
                font-weight:800;
                border:3px solid {border};
                box-shadow:0 6px 16px rgba(0,0,0,0.22);
                font-family:Inter, Arial, sans-serif;
                font-size:13px;
            ">
            {marker_text}
            </div>
            """)).add_to(m)


#styke for map legend
style_html = """
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">

<style>
    .leaflet-container {
        font-family: 'Inter', Arial, sans-serif;
        background: #F8FAFC;
    }

    .cluster-legend {
        position: fixed;
        bottom: 28px;
        left: 28px;
        width: 360px;
        background: rgba(255, 255, 255, 0.88);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(226, 232, 240, 0.95);
        border-radius: 18px;
        z-index: 9999;
        font-size: 13px;
        color: #111827;
        box-shadow: 0 18px 45px rgba(15, 23, 42, 0.22);
        overflow: hidden;
        cursor: move;
    }

    .cluster-legend-header {
        padding: 14px 16px 10px 16px;
        border-bottom: 1px solid rgba(226, 232, 240, 0.9);
    }

    .cluster-legend-title {
        font-size: 15px;
        font-weight: 800;
        letter-spacing: -0.02em;
        margin-bottom: 3px;
    }

    .cluster-legend-subtitle {
        font-size: 11px;
        color: #64748B;
        font-weight: 500;
    }

    .cluster-legend-body {
        padding: 12px 16px 14px 16px;
    }

    .legend-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 9px 0;
        line-height: 1.25;
        font-weight: 500;
    }

    .legend-swatch {
        width: 14px;
        height: 14px;
        border-radius: 5px;
        flex: 0 0 14px;
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.55);
    }

    .legend-line {
        width: 24px;
        height: 4px;
        border-radius: 999px;
        background: #424242;
        flex: 0 0 24px;
    }

    .legend-note {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid rgba(226, 232, 240, 0.9);
        color: #64748B;
        font-size: 11px;
        line-height: 1.35;
    }
</style>
"""

#legend content shown on map 
legend_html = f"""
<div id="clusterLegend" class="cluster-legend">
    <div class="cluster-legend-header">
        <div class="cluster-legend-title">West Midlands clusters & route</div>
        <div class="cluster-legend-subtitle">K-means profiles + patrol route</div>
    </div>

    <div class="cluster-legend-body">
        <div class="legend-row">
            <span class="legend-swatch" style="background:{cluster_colors[1]};"></span>
            <span>High-demand / shoplifting areas</span>
        </div>

        <div class="legend-row">
            <span class="legend-swatch" style="background:{cluster_colors[3]};"></span>
            <span>Medium-high / ASB-heavy demand</span>
        </div>

        <div class="legend-row">
            <span class="legend-swatch" style="background:{cluster_colors[2]};"></span>
            <span>Medium-demand / violence-dominant areas</span>
        </div>

        <div class="legend-row">
            <span class="legend-swatch" style="background:{cluster_colors[0]};"></span>
            <span>Low-demand, volatile</span>
        </div>

        <div class="legend-row">
            <span class="legend-swatch" style="background:#E5E7EB;"></span>
            <span>No cluster / excluded sparse LSOA</span>
        </div>

        <div class="legend-row">
            <span class="legend-line"></span>
            <span>Recommended patrol route</span>
        </div>

        <div class="legend-note">
            Drag this legend to reposition it on the map.
        </div>
    </div>
</div>
"""

drag_script = """
<script>
(function() {
    const legend = document.getElementById("clusterLegend");

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    legend.addEventListener("mousedown", function(e) {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;

        const rect = legend.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;

        legend.style.left = startLeft + "px";
        legend.style.top = startTop + "px";
        legend.style.bottom = "auto";

        e.preventDefault();
    });

    document.addEventListener("mousemove", function(e) {
        if (!isDragging) return;

        const newLeft = startLeft + e.clientX - startX;
        const newTop = startTop + e.clientY - startY;

        legend.style.left = newLeft + "px";
        legend.style.top = newTop + "px";
    });

    document.addEventListener("mouseup", function() {
        isDragging = false;
    });
})();
</script>
"""

# add legend elements to map and save html file
m.get_root().html.add_child(folium.Element(style_html))
m.get_root().html.add_child(folium.Element(legend_html))
m.get_root().html.add_child(folium.Element(drag_script))
m.save("visualizations/west_midlands_demo.html")

print("saved west_midlands_demo.html to visualizations folder")