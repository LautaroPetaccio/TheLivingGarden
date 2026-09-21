// GENERATED from each plant GLB's own materials (scratchpad gen_plant_materials.py, 2026-09-18) — do not hand-edit.
// GltfNodeModifiers REPLACES a node's material, so to pulse emissive into a plant's real look the
// override has to re-supply that look: texture, base colour, alpha mode, metallic/roughness.
// Embedded textures were extracted next to their GLB as <species>_tex<N>.png/jpg.
// 2026-09-19: texture paths DEDUPED by file content (78 paths -> 7 images; e.g. the fantasy
// pack atlas existed in 21 folders) so pulsing flowers share textures instead of each loading
// its own copy against the scene texture limit. Re-run the dedupe if this file is regenerated.

export interface PlantNodeMaterial {
  path: string
  texture?: string
  color: [number, number, number, number]
  blend: boolean
  metallic: number
  roughness: number
}

export const PLANT_MATERIALS: Readonly<Record<string, ReadonlyArray<PlantNodeMaterial>>> = {
  'curly_magic_bean_sprout': [
    { path: "Vegetation_05", texture: 'assets/scene/Models/plants/fantasy/curly_magic_bean_sprout/FanstasyPack_TX.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'dracaena': [
    { path: "Vegetation_02", texture: 'assets/scene/Models/plants/fantasy/curly_magic_bean_sprout/FanstasyPack_TX.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'large_light_green_grass_mound': [
    { path: "GrassPatchLarge_05", texture: 'assets/scene/Models/plants/fantasy/curly_magic_bean_sprout/FanstasyPack_TX.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'large_yellow-green_grass_mound': [
    { path: "GrassPatchLarge_06", texture: 'assets/scene/Models/plants/fantasy/curly_magic_bean_sprout/FanstasyPack_TX.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'magic_bean_sprout': [
    { path: "Vegetation_03", texture: 'assets/scene/Models/plants/fantasy/curly_magic_bean_sprout/FanstasyPack_TX.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'mountain_ragweed': [
    { path: "Bush_Fantasy_01", texture: 'assets/scene/Models/plants/fantasy/curly_magic_bean_sprout/FanstasyPack_TX.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'nutsedge': [
    { path: "Grass_01", texture: 'assets/scene/Models/plants/fantasy/curly_magic_bean_sprout/FanstasyPack_TX.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'purple_heart_plant': [
    { path: "Plant_04", texture: 'assets/scene/Models/plants/fantasy/curly_magic_bean_sprout/FanstasyPack_TX.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'purple_oyster_plant': [
    { path: "Plant_02", texture: 'assets/scene/Models/plants/fantasy/curly_magic_bean_sprout/FanstasyPack_TX.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'shreed_plant': [
    { path: "Plant_03", texture: 'assets/scene/Models/plants/fantasy/curly_magic_bean_sprout/FanstasyPack_TX.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'single_magic_bean_sprout': [
    { path: "Vegetation_04", texture: 'assets/scene/Models/plants/fantasy/curly_magic_bean_sprout/FanstasyPack_TX.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'small_green_grass_mound': [
    { path: "GrassPatchSmall_04", texture: 'assets/scene/Models/plants/fantasy/curly_magic_bean_sprout/FanstasyPack_TX.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'small_lighter_green_grass_mound': [
    { path: "GrassPatchSmall_06", texture: 'assets/scene/Models/plants/fantasy/curly_magic_bean_sprout/FanstasyPack_TX.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'swamp_lily_pad': [
    { path: "Vegetation_01", texture: 'assets/scene/Models/plants/fantasy/curly_magic_bean_sprout/FanstasyPack_TX.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'swamp_red_cactus': [
    { path: "Vegetation_06", texture: 'assets/scene/Models/plants/fantasy/curly_magic_bean_sprout/FanstasyPack_TX.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'sweet_geranium': [
    { path: "Bush_Fantasy_04", texture: 'assets/scene/Models/plants/fantasy/curly_magic_bean_sprout/FanstasyPack_TX.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'three-spiked_grass': [
    { path: "Grass_02", texture: 'assets/scene/Models/plants/fantasy/curly_magic_bean_sprout/FanstasyPack_TX.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'wild_chives': [
    { path: "Vegetation_07", texture: 'assets/scene/Models/plants/fantasy/curly_magic_bean_sprout/FanstasyPack_TX.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'wild_long_mushrooms': [
    { path: "Mushrooms_04", texture: 'assets/scene/Models/plants/fantasy/curly_magic_bean_sprout/FanstasyPack_TX.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'yellow_croton_plant': [
    { path: "Plant_01", texture: 'assets/scene/Models/plants/fantasy/curly_magic_bean_sprout/FanstasyPack_TX.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'balsam_flower': [
    { path: "Plant_02", texture: 'assets/scene/Models/plants/genesis_city/balsam_flower/file1.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'birds_nest_fern': [
    { path: "Plant_01", texture: 'assets/scene/Models/plants/genesis_city/balsam_flower/file1.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'genesis_cactus': [
    { path: "Cactus_01", texture: 'assets/scene/Models/plants/genesis_city/balsam_flower/file1.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'dandelion': [
    { path: "Grass_04", texture: 'assets/scene/Models/plants/genesis_city/balsam_flower/file1.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'flower_sprouts': [
    { path: "Plant_03", texture: 'assets/scene/Models/plants/genesis_city/balsam_flower/file1.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'grass_sprout': [
    { path: "Grass_03", texture: 'assets/scene/Models/plants/genesis_city/balsam_flower/file1.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'gypsy_mushroom': [
    { path: "Mushroom_02", texture: 'assets/scene/Models/plants/genesis_city/balsam_flower/file1.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'java_fern': [
    { path: "Grass_01", texture: 'assets/scene/Models/plants/genesis_city/balsam_flower/file1.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'kangaroo_paws': [
    { path: "Plant_05", texture: 'assets/scene/Models/plants/genesis_city/balsam_flower/file1.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'magenta_mushroom': [
    { path: "Mushroom_01", texture: 'assets/scene/Models/plants/genesis_city/balsam_flower/file1.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'maidenhair_fern': [
    { path: "Plant_07", texture: 'assets/scene/Models/plants/genesis_city/balsam_flower/file1.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'moss_rose': [
    { path: "Plant_06", texture: 'assets/scene/Models/plants/genesis_city/balsam_flower/file1.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'ostrich_ferns': [
    { path: "Grass_02", texture: 'assets/scene/Models/plants/genesis_city/balsam_flower/file1.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'rose': [
    { path: "Flower_03", texture: 'assets/scene/Models/plants/genesis_city/balsam_flower/file1.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'rose_head': [
    { path: "Flower_02", texture: 'assets/scene/Models/plants/genesis_city/balsam_flower/file1.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'sunflower': [
    { path: "Flower_04", texture: 'assets/scene/Models/plants/genesis_city/balsam_flower/file1.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'sunflower_head': [
    { path: "Flower_01", texture: 'assets/scene/Models/plants/genesis_city/balsam_flower/file1.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'sweet_pea': [
    { path: "Plant_04", texture: 'assets/scene/Models/plants/genesis_city/balsam_flower/file1.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'flower_01': [
    { path: "HWN20_Flower_01", texture: 'assets/scene/Models/plants/halloween/flower_01/flower_01_tex0.png', color: [1, 1, 1, 1], blend: false, metallic: 0.2, roughness: 1 },
  ],
  'flower_02': [
    { path: "HWN20_Flower_02", texture: 'assets/scene/Models/plants/halloween/flower_01/flower_01_tex0.png', color: [1, 1, 1, 1], blend: false, metallic: 0.2, roughness: 1 },
  ],
  'pumpkin_leaf': [
    { path: "HWN20_PumpkinLeaf", texture: 'assets/scene/Models/plants/halloween/flower_01/flower_01_tex0.png', color: [1, 1, 1, 1], blend: false, metallic: 0.2, roughness: 1 },
  ],
  'pumpkin_leaf__2': [
    { path: "HWN20_PumpkinLeaf_02", texture: 'assets/scene/Models/plants/halloween/flower_01/flower_01_tex0.png', color: [1, 1, 1, 1], blend: false, metallic: 0.2, roughness: 1 },
  ],
  'areca_palm': [
    { path: "JunglePlant_09", texture: 'assets/scene/Models/plants/pirates/areca_palm/PiratesPack_TX.png.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'bamboo': [
    { path: "Bamboo_01", texture: 'assets/scene/Models/plants/pirates/areca_palm/PiratesPack_TX.png.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'bamboo_culms': [
    { path: "Bamboo_02", texture: 'assets/scene/Models/plants/pirates/areca_palm/PiratesPack_TX.png.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'beach_fern': [
    { path: "Grass_01", texture: 'assets/scene/Models/plants/pirates/areca_palm/PiratesPack_TX.png.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'beachgrass': [
    { path: "Grass_05", texture: 'assets/scene/Models/plants/pirates/areca_palm/PiratesPack_TX.png.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'beachgrass_fern': [
    { path: "JunglePlant_06", texture: 'assets/scene/Models/plants/pirates/areca_palm/PiratesPack_TX.png.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'bird_of_paradise': [
    { path: "JunglePlant_05", texture: 'assets/scene/Models/plants/pirates/areca_palm/PiratesPack_TX.png.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'blue_star_fern': [
    { path: "Grass_02", texture: 'assets/scene/Models/plants/pirates/areca_palm/PiratesPack_TX.png.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'cretan_brake_fern': [
    { path: "Grass_03", texture: 'assets/scene/Models/plants/pirates/areca_palm/PiratesPack_TX.png.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'jungle_fern': [
    { path: "JunglePlant_01", texture: 'assets/scene/Models/plants/pirates/areca_palm/PiratesPack_TX.png.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'lilypad': [
    { path: "LilyPad_01", texture: 'assets/scene/Models/plants/pirates/areca_palm/PiratesPack_TX.png.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'monstera_deliciosa': [
    { path: "JunglePlant_03", texture: 'assets/scene/Models/plants/pirates/areca_palm/PiratesPack_TX.png.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'musa_acuminata': [
    { path: "JunglePlant_04", texture: 'assets/scene/Models/plants/pirates/areca_palm/PiratesPack_TX.png.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'plumeria': [
    { path: "JunglePlant_08", texture: 'assets/scene/Models/plants/pirates/areca_palm/PiratesPack_TX.png.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'sand_reed': [
    { path: "Grass_04", texture: 'assets/scene/Models/plants/pirates/areca_palm/PiratesPack_TX.png.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'sand_weeds': [
    { path: "ShoreGrass_01", texture: 'assets/scene/Models/plants/pirates/areca_palm/PiratesPack_TX.png.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'voxels_cactus': [
    { path: "cactus", texture: 'assets/scene/Models/plants/voxels_pack/cactus/voxels_cactus_tex0.png', color: [1, 1, 1, 1], blend: true, metallic: 0, roughness: 1 },
  ],
  'flower_red': [
    { path: "flower_red", texture: 'assets/scene/Models/plants/voxels_pack/flower_red/flower_red_tex1.png', color: [1, 1, 1, 1], blend: true, metallic: 0, roughness: 0.7 },
  ],
  'flower_yellow': [
    { path: "flower_yellow", texture: 'assets/scene/Models/plants/voxels_pack/flower_red/flower_red_tex1.png', color: [1, 1, 1, 1], blend: true, metallic: 0, roughness: 0.7 },
  ],
  'grass_long': [
    { path: "grass_long_02", texture: 'assets/scene/Models/plants/voxels_pack/flower_red/flower_red_tex1.png', color: [1, 1, 1, 1], blend: true, metallic: 0, roughness: 0.7 },
  ],
  'grass_long_2': [
    { path: "grass_long", texture: 'assets/scene/Models/plants/voxels_pack/flower_red/flower_red_tex1.png', color: [1, 1, 1, 1], blend: true, metallic: 0, roughness: 0.7 },
  ],
  'grass_medium': [
    { path: "grass_medium", texture: 'assets/scene/Models/plants/voxels_pack/flower_red/flower_red_tex1.png', color: [1, 1, 1, 1], blend: true, metallic: 0, roughness: 0.7 },
  ],
  'mushroom_brown': [
    { path: "mushroom_brown", texture: 'assets/scene/Models/plants/voxels_pack/flower_red/flower_red_tex1.png', color: [1, 1, 1, 1], blend: true, metallic: 0, roughness: 0.7 },
  ],
  'vegetation_flowers': [
    { path: "vegetation_light_flowers", texture: 'assets/scene/Models/plants/voxels_pack/flower_red/flower_red_tex1.png', color: [1, 1, 1, 1], blend: true, metallic: 0, roughness: 0.7 },
  ],
  'cactus_1': [
    { path: "Cactus 1", texture: 'assets/scene/Models/plants/western/cactus_1/cactus_1_tex0.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'cactus_2': [
    { path: "Cactus 2", texture: 'assets/scene/Models/plants/western/cactus_1/cactus_1_tex0.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'cactus_3': [
    { path: "Cactus 3", texture: 'assets/scene/Models/plants/western/cactus_1/cactus_1_tex0.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'cactus_4': [
    { path: "Cactus 4", texture: 'assets/scene/Models/plants/western/cactus_1/cactus_1_tex0.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'cactus_5': [
    { path: "Cactus 5", texture: 'assets/scene/Models/plants/western/cactus_1/cactus_1_tex0.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'cactus_6': [
    { path: "Cactus 6", texture: 'assets/scene/Models/plants/western/cactus_1/cactus_1_tex0.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'cactus_7': [
    { path: "Cactus 7", texture: 'assets/scene/Models/plants/western/cactus_1/cactus_1_tex0.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'cactus_8': [
    { path: "Cactus 8", texture: 'assets/scene/Models/plants/western/cactus_1/cactus_1_tex0.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'cactus_9': [
    { path: "Cactus 9", texture: 'assets/scene/Models/plants/western/cactus_1/cactus_1_tex0.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'plant_1': [
    { path: "Plant 1", texture: 'assets/scene/Models/plants/western/cactus_1/cactus_1_tex0.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'plant_2': [
    { path: "Plant 2", texture: 'assets/scene/Models/plants/western/cactus_1/cactus_1_tex0.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
  'void_tulip': [
    { path: "Bush_Fantasy_02", texture: 'assets/scene/Models/plants/fantasy/curly_magic_bean_sprout/FanstasyPack_TX.png', color: [1, 1, 1, 1], blend: false, metallic: 0, roughness: 1 },
  ],
}
