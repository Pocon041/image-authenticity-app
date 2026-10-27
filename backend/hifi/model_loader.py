"""Pinned HiFi-Net general 750001 inference, preserving official numerical conventions."""
import contextlib
import hashlib
from pathlib import Path
import subprocess
import sys
import time

import numpy as np
import torch
from PIL import Image

COMMIT='0ca70d651087bb09959dec583947031c47d30209'
LEAF_LABELS=['real','splicing','inpainting','copy_move','faceshifter','stgan','stargan_v2','hisd','stylegan2','stylegan3','ddpm','ddim','latent_diffusion','guided_diffusion']


def digest(path):
    hasher=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):hasher.update(block)
    return hasher.hexdigest()


class NumpyCompat:
    def __getattr__(self,name):
        return int if name=='int' else getattr(np,name)


class HiFiPredictor:
    def __init__(self,config):
        source=Path(config['sourcePath'])
        git=subprocess.run(['git','-C',str(source),'rev-parse','HEAD'],capture_output=True,text=True,check=True)
        if git.stdout.strip()!=COMMIT:raise ValueError('Unexpected HiFi-Net source revision')
        clean=subprocess.run(['git','-C',str(source),'status','--porcelain','--untracked-files=no'],capture_output=True,text=True,check=True)
        if clean.stdout.strip():raise ValueError('Tracked official source has been modified')
        if not torch.cuda.is_available():raise RuntimeError('Official HiFi-Net source requires CUDA; this adapter does not claim CPU support')
        device=config.get('device','cuda:0')
        if device!='cuda:0':raise ValueError('This initial official-code adapter is fixed to cuda:0')
        sys.path[:0]=[config['dependencyPath'],str(source)]
        import models.seg_hrnet as hrnet
        from models.seg_hrnet_config import get_cfg_defaults
        from models.NLCDetection_api import NLCDetection
        # A module-local compatibility proxy avoids changing shared NumPy or source files.
        hrnet.np=NumpyCompat()
        cfg=get_cfg_defaults();cfg.PRETRAINED=''
        torch.set_num_threads(min(4,torch.get_num_threads()))
        with contextlib.redirect_stdout(sys.stderr):
            self.encoder=hrnet.get_seg_model(cfg)
            self.detector=NLCDetection()
        audits=[]
        for name,model,key in [('HRNet',self.encoder,'encoderPath'),('NLCDetection',self.detector,'detectorPath')]:
            path=Path(config[key])
            payload=torch.load(path,map_location='cpu',weights_only=True)
            state=payload['model']
            if state and all(key.startswith('module.') for key in state):state={key[7:]:value for key,value in state.items()}
            model.load_state_dict(state,strict=True)
            audits.append({'name':name,'sha256':digest(path),'stateKeys':len(state),'missingKeys':[],'unexpectedKeys':[]})
        center_file=Path(config['centerPath'])
        center=torch.load(center_file,map_location='cpu',weights_only=True)
        if tuple(center['center'].shape)!=(18,) or center['radius'].numel()!=1:raise ValueError('Unexpected center/radius dimensions')
        self.center=center['center'].float().to(device)
        self.radius=float(center['radius'])
        self.encoder=self.encoder.float().to(device).eval()
        self.detector=self.detector.float().to(device).eval()
        self.device=device
        self.distance_threshold=float(config.get('distanceThreshold',2.3))
        if self.distance_threshold!=2.3:raise ValueError('Initial evaluation is fixed at the official API distance threshold 2.3')
        self.audit={'upstreamCommit':COMMIT,'variant':'general_750001','strictStateDict':True,'weights':audits,
            'centerSha256':digest(center_file),'radius':self.radius,'inputSize':[256,256],
            'preprocessing':'PIL_bicubic_full_image_resize_RGB_div255_no_imagenet_norm',
            'distanceThreshold':self.distance_threshold,'classificationRule':'argmax_14_way_then_real_vs_nonreal',
            'scoreRule':'1-softmax_leaf_logits_real_class','precision':'fp32','device':device,'torchVersion':torch.__version__,
            'compatibility':['seg_hrnet module-local np.int=int proxy','skip backbone bootstrap then strictly load full task weights']}
        torch.cuda.reset_peak_memory_stats()

    def predict(self,image):
        width,height=image.size
        array=np.asarray(image.convert('RGB').resize((256,256),Image.Resampling.BICUBIC),dtype=np.float32)/255.
        tensor=torch.from_numpy(array.transpose(2,0,1).copy()).unsqueeze(0).to(self.device)
        torch.cuda.synchronize();started=time.perf_counter()
        with torch.inference_mode():
            output=self.detector(self.encoder(tensor),tensor)
            features=output[0]
            if not all(torch.isfinite(value).all() for value in output):raise ValueError('Non-finite model output')
            distributions=[value.softmax(dim=1)[0].cpu().numpy() for value in output[2:]]
            probabilities=distributions[-1]
            distance=torch.nn.functional.pairwise_distance(features.permute(0,2,3,1).reshape(-1,18),self.center,p=2,eps=1e-6).reshape(256,256).cpu().numpy()
            learned_mask=output[1][0].cpu().numpy()
        torch.cuda.synchronize();elapsed=round((time.perf_counter()-started)*1000)
        predicted_class=int(probabilities.argmax())
        mask_256=(distance>=self.distance_threshold).astype(np.uint8)*255
        mask=np.asarray(Image.fromarray(mask_256).resize((width,height),Image.Resampling.NEAREST))
        distances=np.asarray(Image.fromarray(distance.astype(np.float32)).resize((width,height),Image.Resampling.BILINEAR))
        result={'score':float(1-probabilities[0]),'nativePrediction':int(predicted_class!=0),
            'predictionAtPointFive':int(float(1-probabilities[0])>=0.5),
            'leafIndex':predicted_class,'leafLabel':LEAF_LABELS[predicted_class],
            'leafProbabilities':[float(value) for value in probabilities],
            'hierarchyProbabilities':[[float(value) for value in distribution] for distribution in distributions],
            'inferenceMs':elapsed,'predictedAreaFraction':float((mask>0).mean()),
            'distanceMin':float(distance.min()),'distanceMax':float(distance.max()),'distanceMean':float(distance.mean()),
            'auxiliaryMaskMean':float(learned_mask.mean()),'peakCudaMemoryBytes':torch.cuda.max_memory_allocated()}
        return result,mask,distances
