"""Binary metrics with the same conventions as the existing SICA observation."""


def metrics(rows,threshold):
    from sklearn.metrics import roc_auc_score,average_precision_score
    tp=sum(row['label']==1 and row['score']>=threshold for row in rows)
    tn=sum(row['label']==0 and row['score']<threshold for row in rows)
    fp=sum(row['label']==0 and row['score']>=threshold for row in rows)
    fn=sum(row['label']==1 and row['score']<threshold for row in rows)
    real=tn+fp;fake=tp+fn
    return{'count':len(rows),'realCount':real,'fakeCount':fake,'truePositive':tp,'trueNegative':tn,
        'falsePositive':fp,'falseNegative':fn,'accuracy':(tp+tn)/len(rows) if rows else None,
        'precision':tp/(tp+fp) if tp+fp else 0.,'recall':tp/fake if fake else None,
        'specificity':tn/real if real else None,'falsePositiveRate':fp/real if real else None,
        'falseNegativeRate':fn/fake if fake else None,'balancedAccuracy':(tp/fake+tn/real)/2 if real and fake else None,
        'f1':2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else 0.,
        'auc':float(roc_auc_score([row['label'] for row in rows],[row['score'] for row in rows])) if real and fake else None,
        'averagePrecision':float(average_precision_score([row['label'] for row in rows],[row['score'] for row in rows])) if real and fake else None}
