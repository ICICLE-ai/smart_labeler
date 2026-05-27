import os
import re
import requests
import json
from psycopg2 import pool
from psycopg2.extras import RealDictCursor
import time


DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT_STR = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "postgres")
DB_USER = os.getenv("DB_USER", "brijeshnanda")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")

DB_PORT = int(DB_PORT_STR)
DB_POOL_MIN = int(os.getenv("DB_POOL_MIN", "2"))
DB_POOL_MAX = int(os.getenv("DB_POOL_MAX", "20"))

print("connecting to database")
connection_pool = pool.ThreadedConnectionPool(
    DB_POOL_MIN,
    DB_POOL_MAX,
    host=DB_HOST,
    port=DB_PORT,
    database=DB_NAME,
    user=DB_USER,
    password=DB_PASSWORD,
)
print("done connecting to database")


def execute_query(querystring, values):
    connection = None
    cursor = None
    try:
        connection = connection_pool.getconn()
        cursor = connection.cursor(cursor_factory=RealDictCursor)
        if values is not None:
            cursor.execute(querystring, values)
        else:
            cursor.execute(querystring)

        normalized = querystring.upper().lstrip()
        if re.match(r'\s*INSERT\b', normalized):
            cursor.execute("SELECT LASTVAL()")
            rows = cursor.fetchone()["lastval"]
            connection.commit()
        elif re.match(r'\s*(CREATE|UPDATE|ALTER|DROP|TRUNCATE|DELETE)\b', normalized):
            connection.commit()
            rows = []
        else:
            rows = [dict(r) for r in cursor.fetchall()]
        return rows
    except Exception as e:
        if "connection pool exhausted" in str(e):
            print("ran out of connections retrying in .5 secs")
            time.sleep(0.5)
            return execute_query(querystring, values)
        if connection:
            connection.rollback()
        raise
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection_pool.putconn(connection)


print("connection done, start creating tables")

execute_query(
    """CREATE TABLE IF NOT EXISTS "user"(
userid SERIAL PRIMARY KEY,
balance INTEGER,
email TEXT,
username TEXT
)""",
    None,
)

execute_query(
    """CREATE TABLE IF NOT EXISTS pipeline(
pipelineid SERIAL PRIMARY KEY,
pipelineuser INTEGER,
slurmaccount TEXT,
system TEXT,
name TEXT,
type TEXT DEFAULT 'DETECTION',
description TEXT DEFAULT ''
)""",
    None,
)

execute_query(
    """CREATE TABLE IF NOT EXISTS annotator_configuration(
        id SERIAL PRIMARY KEY,
        system TEXT,
        srcImgDir TEXT,
        annotationFilePath TEXT,
        parentpipelineid INTEGER,
        FOREIGN KEY(parentpipelineid) REFERENCES pipeline(pipelineid)
    )""",
    None,
)

execute_query(
    """CREATE TABLE IF NOT EXISTS query_image_configuration(
        id SERIAL PRIMARY KEY,
        objectnessThreshold float DEFAULT 0.1,
        nmsIoUThreshold float DEFAULT 0.5,
        similarityThreshold float DEFAULT 0.2,
        queryImagePath TEXT,
        outputDir TEXT,
        device TEXT,
        method TEXT,
        parentpipelineid INTEGER,
        objectnessThresholdJobId TEXT,
        detectionJobId TEXT,
        system TEXT,
        object_feature_tensor_file_path TEXT,
        is_query_dir BOOLEAN DEFAULT FALSE,
        name TEXT DEFAULT '',
        proposer_ids TEXT DEFAULT '',
        embedder_ids TEXT DEFAULT '',
        is_sahi BOOLEAN DEFAULT FALSE,
        tile_size INTEGER DEFAULT 640,
        overlap_ratio DOUBLE PRECISION DEFAULT 0.1,
        batch_size INTEGER DEFAULT 16,
        proposer_models TEXT DEFAULT '',
        embedder_models TEXT DEFAULT '',
        class_support_paths TEXT DEFAULT '',
        proposal_tensor_paths TEXT DEFAULT '',
        node_count INTEGER DEFAULT 1,
        cores_per_node INTEGER DEFAULT 8,
        memory_mb INTEGER DEFAULT 64800,
        max_minutes INTEGER DEFAULT 210,
        FOREIGN KEY(parentpipelineid) REFERENCES pipeline(pipelineid)
    )""",
    None,
)

for col, defval in [
    ("node_count", "1"),
    ("cores_per_node", "8"),
    ("memory_mb", "64800"),
    ("max_minutes", "210"),
]:
    execute_query(
        f"ALTER TABLE query_image_configuration ADD COLUMN IF NOT EXISTS {col} INTEGER DEFAULT {defval}",
        None,
    )

execute_query(
    """CREATE TABLE IF NOT EXISTS object_detection(
        detectionid SERIAL PRIMARY KEY,
        srcImgDir TEXT,
        outputDir TEXT,
        annotationFilePath TEXT,
        method TEXT,
        model_ids TEXT,
        cropSize INTEGER,
        device TEXT,
        parentpipeline INTEGER,
        generate_class_supports_job_id TEXT,
        system TEXT DEFAULT 'expanse-tapis',
        class_supports_tensor_file_path TEXT,
        current_query_image_configuration INTEGER,
        name TEXT DEFAULT '',
        crop_sizes TEXT DEFAULT '',
        model_names TEXT DEFAULT '',
        FOREIGN KEY(current_query_image_configuration) REFERENCES query_image_configuration(id),
        FOREIGN KEY(parentpipeline) REFERENCES pipeline(pipelineid)
    )""",
    None,
)

# Migrations for existing databases
execute_query("ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''", None)
execute_query("ALTER TABLE pipeline DROP CONSTRAINT IF EXISTS pipeline_pipelineuser_fkey", None)
execute_query("ALTER TABLE pipeline DROP COLUMN IF EXISTS metadata", None)
execute_query("ALTER TABLE object_detection DROP COLUMN IF EXISTS percentcomplete", None)
execute_query("ALTER TABLE annotator_configuration ADD COLUMN IF NOT EXISTS fileType TEXT DEFAULT 'default'", None)
execute_query('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE', None)


def get_username(userid):
    rows = execute_query('SELECT username FROM "user" WHERE userid = %s', (userid,))
    return rows[0]["username"]


def username_to_uid(user):
    rows = execute_query('SELECT userid FROM "user" WHERE username = %s', (user,))
    if rows:
        return rows[0]["userid"]
    try:
        uid = execute_query('INSERT INTO "user" (username) VALUES (%s)', (user,))
    except Exception:
        # Race condition: another request inserted this user concurrently
        rows = execute_query('SELECT userid FROM "user" WHERE username = %s', (user,))
        if rows:
            return rows[0]["userid"]
        raise
    return uid


def is_admin_user(username):
    rows = execute_query('SELECT is_admin FROM "user" WHERE username = %s', (username,))
    return bool(rows and rows[0]["is_admin"])


def is_demo_pipeline(pipeline_id):
    rows = execute_query(
        "SELECT pipelineuser FROM pipeline WHERE pipelineid = %s", (pipeline_id,)
    )
    return bool(rows and rows[0]["pipelineuser"] == 0)


def make_jobdir(dataloc, pipeid, token, js=None):
    if dataloc[-1] == "/":
        dataloc = dataloc[0:-1]
    digidpath = dataloc[0 : dataloc.rfind("/")] + "/harvest_jobs/" + pipeid
    digidpath = digidpath.replace("tapis://", "")
    headers = {"X-Tapis-Token": token, "Content-Type": "application/json"}
    url = f"https://icicleai.tapis.io/v3/files/ops/{(digidpath[0 : digidpath.index('/')])}/"
    rdata = {"path": f"{digidpath[digidpath.index('/') + 1 :]}"}
    response = requests.post(url, data=json.dumps(rdata), headers=headers)
    print(response.content)
    if js:
        headers = {"X-Tapis-Token": token}
        url = f"https://icicleai.tapis.io/v3/files/ops/{digidpath}/labelled_image_info.json"
        rdata = {"file": f"{str(json.dumps(json.loads(js)))}"}
        print(url)
        print(rdata)
        response = requests.post(url, files=rdata, headers=headers)
        print(response.content)
    return digidpath


def get_object_detection_pipeline(id):
    rows = execute_query(
        """SELECT od.*, (p.pipelineuser = 0) AS is_demo
           FROM object_detection od
           JOIN pipeline p ON od.parentpipeline = p.pipelineid
           WHERE od.parentpipeline = %s""",
        (id,),
    )
    return rows[0] if rows else None

###### Pipeline related queries ######

def create_pipeline(user, data):
    if isinstance(data, str):
        data = json.loads(data)
    userid = username_to_uid(user)
    rows = execute_query(
        "INSERT INTO pipeline (name, pipelineuser, slurmaccount, type, description) VALUES (%s, %s, %s, %s, %s)",
        (data["name"], userid, data.get("slurm", ""), data["type"], data.get("description", "")),
    )
    pipeid = rows
    print(f"created pipeline with id: {pipeid}")
    execute_query(
        "INSERT INTO object_detection (parentpipeline) VALUES (%s)", (pipeid,)
    )
    return str(pipeid)


def get_pipelines(user):
    uid = username_to_uid(user)
    rows = execute_query(
        "SELECT * FROM pipeline WHERE pipelineuser = %s OR pipelineuser = 0 ORDER BY pipelineuser ASC, pipelineid ASC",
        (uid,),
    )
    return rows

def update_pipeline(pipeline_id, user, data):
    update_fields = []
    values = []
    for key, value in data.items():
        if key in ["name", "slurmaccount", "type", "description"]:
            update_fields.append(f"{key} = %s")
            values.append(value)
    if not update_fields:
        return False
    values.append(pipeline_id)
    execute_query(
        f"UPDATE pipeline SET {', '.join(update_fields)} WHERE pipelineid = %s",
        tuple(values),
    )
    return True

def delete_pipeline(pipeline_id, user):
    try:
        execute_query("DELETE FROM query_image_configuration WHERE parentpipelineid = %s", (pipeline_id,))
        execute_query("DELETE FROM object_detection WHERE parentpipeline = %s", (pipeline_id,))
        execute_query("DELETE FROM pipeline WHERE pipelineid = %s", (pipeline_id,))
    except Exception as e:
        print(f"Error deleting pipeline {pipeline_id}: {str(e)}")
        return False
    return True

###################################################

####### Annotator Configuration ###################

def create_annotator_configuration(pipeline_id, data):
    return execute_query(
        "INSERT INTO annotator_configuration (system, srcImgDir, annotationFilePath, parentpipelineid, fileType) VALUES (%s, %s, %s, %s, %s)",
        (data.get("system", ""), data.get("srcImgDir", ""), data.get("annotationFilePath", ""), pipeline_id, data.get("fileType", "default")),
    )


def get_annotator_configuration(pipeline_id):
    rows = execute_query(
        "SELECT * FROM annotator_configuration WHERE parentpipelineid = %s ORDER BY id DESC LIMIT 1",
        (pipeline_id,),
    )
    return rows[0] if rows else None


def get_all_annotator_configurations(pipeline_id):
    return execute_query(
        "SELECT * FROM annotator_configuration WHERE parentpipelineid = %s ORDER BY id ASC",
        (pipeline_id,),
    )


def get_annotator_configuration_by_id(config_id):
    rows = execute_query(
        "SELECT * FROM annotator_configuration WHERE id = %s", (config_id,)
    )
    return rows[0] if rows else None


def update_annotator_configuration(config_id, updates):
    update_fields, values = [], []
    for key, value in updates.items():
        if key in ["system", "srcImgDir", "annotationFilePath", "fileType"]:
            update_fields.append(f"{key} = %s")
            values.append(value)
    if not update_fields:
        return False
    values.append(config_id)
    execute_query(
        f"UPDATE annotator_configuration SET {', '.join(update_fields)} WHERE id = %s",
        tuple(values),
    )
    return True


def delete_annotator_configuration(config_id):
    execute_query("DELETE FROM annotator_configuration WHERE id = %s", (config_id,))
    return True

##################################################

def set_preprocessed(pipeline, dataloc, geoloc, shploc, csvloc, token):
    jobdir = make_jobdir(dataloc, pipeline, token)
    execute_query(
        "UPDATE pipeline SET jobdir=%s, currentdata=%s, inputdata=%s WHERE pipelineid = %s",
        (jobdir, dataloc, dataloc, pipeline),
    )
    execute_query(
        "UPDATE preprocess SET geospatialdata=%s, shapefile=%s, csv=%s WHERE parentpipeline=%s",
        (geoloc, shploc, csvloc, pipeline),
    )


def get_pipeline_system(pipeline):
    rows = execute_query("SELECT system FROM pipeline WHERE pipelineid = %s", (pipeline,))
    return rows[0]["system"] if rows else None


def get_gpus(pipeline):
    rows = execute_query(
        "SELECT gpus FROM training WHERE parentpipeline = %s", (pipeline,)
    )
    return rows[0]["gpus"]


def is_user_pipeline(pipeline, user):
    uid = username_to_uid(user)
    rows = execute_query(
        "SELECT * FROM pipeline WHERE pipelineid = %s AND (pipelineuser = %s OR pipelineuser = 0)",
        (pipeline, uid),
    )
    return rows


def get_slurmaccount(digid):
    rows = execute_query(
        "SELECT slurmaccount FROM pipeline WHERE pipelineid = %s", (digid,)
    )
    return rows[0]["slurmaccount"]


def get_username_from_pipelineid(pipeline_id):
    rows = execute_query(
        "SELECT pipelineuser FROM pipeline WHERE pipelineid = %s", (pipeline_id,)
    )
    if not rows:
        return None
    userid = rows[0]["pipelineuser"]
    rows = execute_query('SELECT username FROM "user" WHERE userid = %s', (userid,))
    return rows[0]["username"] if rows else None


def create_object_detection_entry(id, data):
    cropSize = 1024
    if "cropSize" not in data or not isinstance(data["cropSize"], int):
        if "cropSize" in data and isinstance(data["cropSize"], str):
            try:
                parsed_list = json.loads(data["cropSize"])
                if isinstance(parsed_list, list) and parsed_list:
                    cropSize = int(parsed_list[0])
            except (json.JSONDecodeError, ValueError, IndexError):
                cropSize = 1024
    else:
        cropSize = data["cropSize"]

    execute_query(
        "UPDATE object_detection SET system = %s, srcImgDir = %s, annotationFilePath = %s, model_ids = %s, method = %s, device = %s, outputDir = %s, cropSize = %s, name = %s, crop_sizes = %s, model_names = %s WHERE parentpipeline = %s",
        (
            data["system"],
            data["srcImgDir"],
            data["annotationFilePath"],
            data["model_ids"],
            data["method"],
            data["device"],
            data["outputDir"],
            cropSize,
            data.get("name", ""),
            data.get("crop_sizes", ""),
            data.get("model_names", ""),
            id,
        ),
    )


def update_object_detection(query_id, updates):
    update_fields = []
    values = []
    for key, value in updates.items():
        if key in [
            "srcImgDir",
            "annotationFilePath",
            "cropSize",
            "device",
            "modelName",
            "method",
            "system",
            "outputDir",
            "class_supports_tensor_file_path",
            "generate_class_supports_job_id",
            "current_query_image_configuration",
            "name",
            "crop_sizes",
        ]:
            update_fields.append(f"{key} = %s")
            values.append(value)
    if not update_fields:
        return False
    values.append(query_id)
    execute_query(
        f"UPDATE object_detection SET {', '.join(update_fields)} WHERE parentpipeline = %s",
        tuple(values),
    )
    return True


def create_query_image_configuration(pipeline_id, query_data):
    rows = execute_query(
        """INSERT INTO query_image_configuration
        (objectnessThreshold, nmsIoUThreshold, similarityThreshold,
        queryImagePath, outputDir, device, proposer_ids, embedder_ids, batch_size, is_sahi, tile_size, overlap_ratio, method, parentpipelineid, system, is_query_dir, name,
        node_count, cores_per_node, memory_mb, max_minutes)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            query_data.get("objectnessThreshold", 0.1),
            query_data.get("nmsIoUThreshold", 0.5),
            query_data.get("similarityThreshold", 0.2),
            query_data["queryImagePath"],
            query_data["outputDir"],
            query_data["device"],
            query_data.get("proposer_ids", ""),
            query_data.get("embedder_ids", ""),
            query_data.get("batch_size", 4),
            query_data.get("enableSahi", False),
            query_data.get("tileSize", 960),
            query_data.get("overlap_ratio", 0.25),
            query_data["method"],
            pipeline_id,
            query_data["system"],
            query_data.get("is_query_dir", False),
            query_data.get("name", ""),
            query_data.get("node_count", 1),
            query_data.get("cores_per_node", 8),
            query_data.get("memory_mb", 64800),
            query_data.get("max_minutes", 210),
        ),
    )
    return rows


def get_query_image_configuration(query_id):
    rows = execute_query(
        "SELECT * FROM query_image_configuration WHERE id = %s",
        (str(query_id),),
    )
    return rows[0] if rows else None


def get_all_query_configurations(pipeline_id):
    rows = execute_query(
        "SELECT * FROM query_image_configuration WHERE parentpipelineid = %s",
        (pipeline_id,),
    )
    if not rows:
        return []
    return [
        {
            "id": row["id"],
            "objectnessThreshold": row["objectnessthreshold"],
            "nmsIoUThreshold": row["nmsiouthreshold"],
            "similarityThreshold": row["similaritythreshold"],
            "queryImagePath": row["queryimagepath"],
            "outputDir": row["outputdir"],
            "device": row["device"],
            "method": row["method"],
            "objectnessThresholdJobId": row["objectnessthresholdjobid"],
            "detectionJobId": row["detectionjobid"],
            "system": row["system"],
            "object_feature_tensor_file_path": row["object_feature_tensor_file_path"],
            "name": row["name"],
            "proposer_ids": row["proposer_ids"],
            "embedder_ids": row["embedder_ids"],
            "is_sahi": row["is_sahi"],
            "tile_size": row["tile_size"],
            "overlap_ratio": row["overlap_ratio"],
            "batch_size": row["batch_size"],
            "proposer_models": row.get("proposer_models", ""),
            "embedder_models": row.get("embedder_models", ""),
            "class_support_paths": row.get("class_support_paths", ""),
            "proposal_tensor_paths": row.get("proposal_tensor_paths", ""),
            "node_count": row.get("node_count", 1),
            "cores_per_node": row.get("cores_per_node", 8),
            "memory_mb": row.get("memory_mb", 64800),
            "max_minutes": row.get("max_minutes", 210),
        }
        for row in rows
    ]


def update_query_image_configuration(query_id, updates):
    update_fields = []
    values = []
    for key, value in updates.items():
        if key in [
            "objectnessThreshold",
            "nmsIoUThreshold",
            "similarityThreshold",
            "queryImagePath",
            "device",
            "proposer_ids",
            "embedder_ids",
            "proposer_models",
            "embedder_models",
            "batch_size",
            "is_sahi",
            "tile_size",
            "overlap_ratio",
            "method",
            "system",
            "outputDir",
            "object_feature_tensor_file_path",
            "detectionJobId",
            "objectnessThresholdJobId",
            "is_query_dir",
            "name",
            "class_support_paths",
            "proposal_tensor_paths",
            "node_count",
            "cores_per_node",
            "memory_mb",
            "max_minutes",
        ]:
            update_fields.append(f"{key} = %s")
            values.append(value)
    if not update_fields:
        return False
    values.append(query_id)
    execute_query(
        f"UPDATE query_image_configuration SET {', '.join(update_fields)} WHERE id = %s",
        tuple(values),
    )
    return True


def get_latest_query_image_configuration_id(parentpipeid):
    rows = execute_query(
        "SELECT id FROM query_image_configuration WHERE parentpipelineid = %s ORDER BY id DESC LIMIT 1",
        (parentpipeid,),
    )
    return rows[0]["id"] if rows else None
